function doPost(e) {
  try {
    // Get the sheet named "Emails". If it doesn't exist, create it.
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Emails");
    if (!sheet) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Emails");
      // Set the header row for the new sheet
      sheet.appendRow(["Timestamp", "Email"]);
    }
    
    // Parse the data sent from the website's popup form
    var postData = JSON.parse(e.postData.contents);
    var email = postData.email;
    
    // Make sure an email was actually sent
    if (!email) {
      return ContentService
        .createTextOutput(JSON.stringify({ "status": "error", "message": "Email not provided." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Add a new row to the sheet with the current date and the email
    var timestamp = new Date();
    sheet.appendRow([timestamp, email]);
    
    // Send back a success message
    return ContentService
      .createTextOutput(JSON.stringify({ "status": "success", "message": "Email added." }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Log any errors for debugging
    Logger.log(error.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ "status": "error", "message": "An error occurred: " + error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
} 