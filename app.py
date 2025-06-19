import os
import json
from flask import Flask, render_template, request, jsonify, make_response
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI
import requests
from bs4 import BeautifulSoup

load_dotenv()

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Global variable to store the dataframe
df = None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload_csv', methods=['POST'])
def upload_csv():
    global df
    if 'csv_file' not in request.files:
        return jsonify({'error': 'No file part in request'}), 400
    
    file = request.files['csv_file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if file and file.filename.endswith('.csv'):
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        df = pd.read_csv(filepath)
        
        # Convert nan to empty string for better display
        df = df.fillna('')

        # Return data and headers as JSON
        data = df.to_dict(orient='records')
        headers = list(df.columns)
        return jsonify({'data': data, 'headers': headers})

    return jsonify({'error': 'Invalid file type'}), 400

@app.route('/add_columns', methods=['POST'])
def add_columns():
    global df
    if df is None:
        return jsonify({'error': 'No data available. Please upload a CSV first.'}), 400

    if 'Subject Line' not in df.columns:
        df['Subject Line'] = ''
    if 'Opening Message' not in df.columns:
        df['Opening Message'] = ''
    
    data = df.to_dict(orient='records')
    headers = list(df.columns)
    return jsonify({'data': data, 'headers': headers})

@app.route('/remove_rows', methods=['POST'])
def remove_rows():
    global df
    if df is None:
        return jsonify({'error': 'No data available. Please upload a CSV first.'}), 400
    
    text_to_remove = request.json.get('text', '')
    if not text_to_remove:
        return jsonify(success=False, message="No text provided for removal."), 400

    initial_rows = len(df)
    
    # Create a boolean mask for rows to keep
    mask = ~df.apply(lambda row: row.astype(str).str.contains(text_to_remove, case=False, na=False).any(), axis=1)
    df = df[mask].reset_index(drop=True)

    rows_removed = initial_rows - len(df)
    
    return jsonify(
        success=True, 
        message=f"Removed {rows_removed} row(s) containing '{text_to_remove}'.",
        headers=df.columns.tolist(),
        data=df.to_dict(orient='records')
    )

@app.route('/split_email_to_website', methods=['POST'])
def split_email_to_website():
    global df
    if df is None:
        return jsonify({'error': 'No data available. Please upload a CSV first.'}), 400

    email_col = next((col for col in df.columns if 'email' in col.lower()), None)

    if not email_col:
        return jsonify({'error': 'No "Email" column found in the uploaded data.'}), 400

    if 'Website' not in df.columns:
        email_col_index = df.columns.get_loc(email_col)
        df.insert(email_col_index + 1, 'Website', '')

    def extract_domain(email):
        if pd.isna(email) or '@' not in str(email):
            return ''
        return str(email).split('@')[1]

    df['Website'] = df.apply(
        lambda row: extract_domain(row[email_col]) if pd.isna(row['Website']) or row['Website'] == '' else row['Website'],
        axis=1
    )
    
    data = df.to_dict(orient='records')
    headers = list(df.columns)
    return jsonify({'data': data, 'headers': headers})

@app.route('/generate_text', methods=['POST'])
def generate_text():
    global df
    data = request.get_json()
    row_index = data['row_index']
    api_key = data['api_key']
    provider = data['provider']
    value_prop = data.get('value_prop', '')
    subject_prompt_template = data.get('subject_prompt', '')
    message_prompt_template = data.get('message_prompt', '')
    
    row_data = df.iloc[row_index].to_dict()

    # The AI's core instructions
    system_prompt = 'You are a helpful assistant specialized in writing compelling cold emails. Your response should be a JSON object with two keys: "subject" and "message".'

    # Construct data strings for the templates
    company_data_str = "\\n".join([f"- {key}: {value}" for key, value in row_data.items() if key not in ['Subject Line', 'Opening Message', 'Scraped Text'] and pd.notna(value) and value != ''])
    scraped_text_str = row_data.get('Scraped Text', '')
    if pd.isna(scraped_text_str) or scraped_text_str == '':
        scraped_text_str = 'No website text was scraped.'

    # Replace placeholders in the prompts
    final_subject_prompt = subject_prompt_template.replace('{{company_data}}', company_data_str).replace('{{scraped_text}}', scraped_text_str)
    final_message_prompt = message_prompt_template.replace('{{company_data}}', company_data_str).replace('{{scraped_text}}', scraped_text_str)

    # Combine the user prompts into a single user message for the AI
    user_prompt = f"""
I am a B2B sales rep. My value proposition is:
{value_prop}
---
TASK 1: SUBJECT LINE
Based on the data below, fulfill the following instruction:
"{final_subject_prompt}"
---
TASK 2: OPENING MESSAGE
Based on the data below, fulfill the following instruction:
"{final_message_prompt}"
---
CONTEXTUAL DATA:
Company Data:
{company_data_str}

Scraped Website Text:
{scraped_text_str}
"""

    try:
        # Initialize client
        if provider == 'deepseek':
            client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
            model = "deepseek-chat"
        elif provider == 'openai':
            client = OpenAI(api_key=api_key)
            model = "gpt-3.5-turbo"
        else:
            return jsonify({'error': 'Invalid AI provider specified'}), 400

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            max_tokens=400,
            stream=False
        )
        
        # Parse the JSON response
        response_json = json.loads(response.choices[0].message.content)
        subject_line = response_json.get("subject", "")
        opening_message = response_json.get("message", "")

        # Update the DataFrame
        df.at[row_index, 'Subject Line'] = subject_line
        df.at[row_index, 'Opening Message'] = opening_message

        return jsonify({
            'subject': subject_line,
            'message': opening_message
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/scrape_website', methods=['POST'])
def scrape_website():
    global df
    if df is None:
        return jsonify({'error': 'No data available.'}), 400
        
    row_index = request.json['row_index']
    
    if 'Website' not in df.columns:
        return jsonify({'error': 'No "Website" column found.'}), 400

    url = df.at[row_index, 'Website']
    
    if pd.isna(url) or url == '':
        return jsonify({'scraped_text': 'Skipped - No URL'})

    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        
        for script_or_style in soup(['script', 'style']):
            script_or_style.decompose()
        
        text = soup.get_text()
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        clean_text = '\n'.join(chunk for chunk in chunks if chunk)
        
        # Ensure 'Scraped Text' column exists
        if 'Scraped Text' not in df.columns:
            df['Scraped Text'] = ''
        
        scraped_content = clean_text if clean_text else 'Skipped - No content found'
        df.at[row_index, 'Scraped Text'] = scraped_content
        
        return jsonify({'scraped_text': scraped_content})
    except requests.exceptions.RequestException:
        skipped_message = 'Skipped - Could not reach URL'
        if 'Scraped Text' in df.columns:
            df.at[row_index, 'Scraped Text'] = skipped_message
        return jsonify({'scraped_text': skipped_message})

@app.route('/export_csv', methods=['GET'])
def export_csv():
    global df
    if df is None:
        return "No data to export", 400

    # Create a response with the CSV data
    resp = make_response(df.to_csv(index=False, encoding='utf-8-sig'))
    resp.headers["Content-Disposition"] = "attachment; filename=export.csv"
    resp.headers["Content-Type"] = "text/csv"
    return resp

if __name__ == '__main__':
    app.run(debug=True)
