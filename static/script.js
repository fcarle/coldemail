$(document).ready(function() {
    // Email Popup Logic
    const emailModal = new bootstrap.Modal(document.getElementById('emailPopup'));
    const hasVisited = localStorage.getItem('hasVisited');

    if (!hasVisited) {
        emailModal.show();
    }

    $('#email-form').on('submit', function(e) {
        e.preventDefault();
        const userEmail = $('#user-email').val();
        
        // --- IMPORTANT ---
        // PASTE THE WEB APP URL YOU COPIED FROM GOOGLE APPS SCRIPT HERE
        const a_p_p_s_script_url = 'https://script.google.com/macros/s/AKfycbzI8s0oDzvyxifzIOejU6XtjpoTcukaG_Kzw-7opxYZ171N6BONWCcFBugKPQ5pYWayRQ/exec'; 

        if (!userEmail) {
            alert('Please enter a valid email address.');
            return;
        }

        if (a_p_p_s_script_url === 'YOUR_APPS_SCRIPT_URL_HERE') {
            alert('Developer: The Apps Script URL is not configured. Email will be saved to local storage only.');
            localStorage.setItem('userEmail', userEmail);
            localStorage.setItem('hasVisited', 'true');
            emailModal.hide();
            return;
        }
        
        // Show loading state on the button
        const submitButton = $(this).find('button[type="submit"]');
        submitButton.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...');

        // Use fetch to send data to the Google Apps Script
        fetch(a_p_p_s_script_url, {
            method: 'POST',
            mode: 'no-cors', // 'no-cors' is required for simple cross-origin requests to Apps Script
            body: JSON.stringify({ email: userEmail }),
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .finally(() => {
            // We use .finally because with 'no-cors' we can't read the response.
            // We'll assume it was successful and hide the modal.
            localStorage.setItem('userEmail', userEmail);
            localStorage.setItem('hasVisited', 'true');
            emailModal.hide();

            // Restore button
            submitButton.prop('disabled', false).text('Continue');
        });
    });

    let df_data = null;
    let headers = [];

    // Initial state
    updateButtonStates();

    // Re-render table with current data
    function renderTable() {
        if (!df_data || df_data.length === 0) {
            $('#table-container').html(`
                <div class="d-flex align-items-center justify-content-center h-100">
                    <p class="text-muted">Upload a CSV to get started.</p>
                </div>
            `);
            updateButtonStates();
            return;
        }

        var table = $('<table class="table table-bordered table-hover"></table>');
        var thead = $('<thead></thead>');
        var tr = $('<tr></tr>');
        headers.forEach(function(header) {
            tr.append('<th>' + header + '</th>');
        });
        thead.append(tr);
        table.append(thead);

        var tbody = $('<tbody></tbody>');
        df_data.forEach(function(row, rowIndex) {
            var tr = $('<tr></tr>');
            headers.forEach(function(header) {
                var cellValue = row[header];
                if (header === 'Subject Line' || header === 'Opening Message') {
                    // Make these cells editable
                    var input = $('<textarea class="form-control"></textarea>').val(cellValue);
                    input.on('change', function() {
                        df_data[rowIndex][header] = $(this).val();
                    });
                    tr.append($('<td></td>').append(input));
                } else {
                    // Add truncatable class for styling
                    var td = $('<td></td>').addClass('truncatable').prop('title', cellValue).text(cellValue !== null ? cellValue : '');
                    tr.append(td);
                }
            });

            tbody.append(tr);
        });
        table.append(tbody);

        $('#table-container').empty().append(table);
        updateButtonStates();
    }

    // Handle CSV upload
    $('#upload-form').on('submit', function(e) {
        e.preventDefault();
        var formData = new FormData();
        var fileInput = $('#csv-file')[0];
        
        if (fileInput.files.length === 0) {
            showToast('Please select a file to upload.');
            return;
        }
        formData.append('csv_file', fileInput.files[0]);

        $.ajax({
            url: '/upload_csv',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                df_data = response.data;
                headers = response.headers;
                renderTable();
            },
            error: function() {
                showToast('Error uploading CSV.');
            }
        });
    });

    // Add "Subject Line" and "Opening Message" columns
    $('#add-columns-btn').on('click', function() {
        if (!df_data || df_data.length === 0) {
            showToast('Please upload a CSV file first.');
            return;
        }
        $.ajax({
            url: '/add_columns',
            type: 'POST',
            contentType: 'application/json',
            success: function(response) {
                df_data = response.data;
                headers = response.headers;
                renderTable();
            },
            error: function() {
                showToast('Error adding columns.');
            }
        });
    });

    // Remove rows containing specific text
    $('#remove-rows-btn').on('click', function() {
        var textToRemove = $('#remove-rows-text').val();
        if (!textToRemove) {
            showToast('Please enter text to identify rows for removal.');
            return;
        }

        $.ajax({
            url: '/remove_rows',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ text: textToRemove }),
            success: function(response) {
                if (response.success) {
                    headers = response.headers;
                    df_data = response.data;
                    renderTable();
                    showToast(response.message);
                    $('#remove-rows-text').val(''); // Clear input
                } else {
                    showToast('Error: ' + response.message);
                }
            },
            error: function() {
                showToast('An unexpected error occurred while removing rows.');
            }
        });
    });

    // Split email to create a website column
    $('#split-email-btn').on('click', function() {
        $.ajax({
            url: '/split_email_to_website',
            type: 'POST',
            contentType: 'application/json',
            success: function(response) {
                if(response.error) {
                    showToast('Error: ' + response.error);
                } else {
                    df_data = response.data;
                    headers = response.headers;
                    renderTable();
                }
            },
            error: function() {
                showToast('An unexpected error occurred.');
            }
        });
    });

    // Scrape websites
    $('#scrape-websites-btn').on('click', function() {
        var totalRows = df_data.length;
        if (totalRows === 0) return;

        $('#progress-container').show();
        $('#progress-text').show();
        var progressBar = $('#progress-bar');
        var progressText = $('#progress-text');
        var completedRows = 0;

        function updateProgress() {
            var percentComplete = totalRows > 0 ? (completedRows / totalRows) * 100 : 0;
            progressBar.width(percentComplete + '%');
            progressText.text(`Scraping... ${completedRows} / ${totalRows} (${Math.round(percentComplete)}%)`);
        }

        updateProgress();

        var scrapePromises = df_data.map((row, index) => {
            return new Promise((resolve) => {
                $.ajax({
                    url: '/scrape_website',
                    type: 'POST',
                    data: JSON.stringify({ row_index: index }),
                    contentType: 'application/json',
                    success: function(response) {
                        if (response.scraped_text) {
                            df_data[index]['Scraped Text'] = response.scraped_text;
                        }
                    },
                    error: function() {
                       console.error('Failed to scrape for row ' + index);
                    },
                    complete: function() {
                        completedRows++;
                        updateProgress();
                        resolve();
                    }
                });
            });
        });

        Promise.allSettled(scrapePromises).then(() => {
            if (!headers.includes('Scraped Text')) {
                headers.push('Scraped Text');
            }
            renderTable();
            setTimeout(() => {
                $('#progress-container').fadeOut();
                $('#progress-text').fadeOut();
            }, 1000);
        });
    });

    // Handle text generation for all rows
    $('#generate-text-btn').on('click', function() {
        var totalRows = df_data.length;
        if (totalRows === 0) return;

        var apiKey = $('#api-key').val();
        if (!apiKey) {
            showToast('Please enter your API key before generating text.');
            return;
        }

        $('#progress-container').show();
        $('#progress-text').show();
        var progressBar = $('#progress-bar');
        var progressText = $('#progress-text');
        var completedRows = 0;

        function updateProgress() {
            var percentComplete = totalRows > 0 ? (completedRows / totalRows) * 100 : 0;
            progressBar.width(percentComplete + '%');
            progressText.text(`Generating Text... ${completedRows} / ${totalRows} (${Math.round(percentComplete)}%)`);
        }

        updateProgress();

        var generatePromises = df_data.map((row, index) => {
            return new Promise((resolve) => {
                $.ajax({
                    url: '/generate_text',
                    type: 'POST',
                    data: JSON.stringify({
                        row_index: index,
                        api_key: apiKey,
                        provider: $('#ai-provider').val(),
                        value_prop: $('#value-prop').val(),
                        subject_prompt: $('#subject-prompt-template').val(),
                        message_prompt: $('#message-prompt-template').val()
                    }),
                    contentType: 'application/json',
                    success: function(response) {
                        if (response.subject && response.message) {
                            df_data[index]['Subject Line'] = response.subject;
                            df_data[index]['Opening Message'] = response.message;
                        }
                    },
                    error: function() {
                       console.error('Failed to generate text for row ' + index);
                    },
                    complete: function() {
                        completedRows++;
                        updateProgress();
                        resolve();
                    }
                });
            });
        });

        Promise.allSettled(generatePromises).then(() => {
            renderTable();
            setTimeout(() => {
                $('#progress-container').fadeOut();
                $('#progress-text').fadeOut();
            }, 1000);
        });
    });

    function updateButtonStates() {
        const hasData = df_data && df_data.length > 0;
        const hasWebsiteColumn = hasData && headers.includes('Website');

        $('#add-columns-btn').prop('disabled', !hasData);
        $('#remove-rows-btn').prop('disabled', !hasData);
        $('#split-email-btn').prop('disabled', !hasData);
        $('#scrape-websites-btn').prop('disabled', !hasWebsiteColumn);
        $('#generate-text-btn').prop('disabled', !hasData);

        const exportBtn = $('#export-csv-btn');
        if (hasData) {
            exportBtn.removeClass('disabled');
        } else {
            exportBtn.addClass('disabled');
        }
    }

    $('#export-csv-btn').on('click', function(e) {
        if ($(this).hasClass('disabled')) {
            e.preventDefault();
        }
    });

    function showToast(message) {
        // Simple toast notification for now
        alert(message);
    }
}); 