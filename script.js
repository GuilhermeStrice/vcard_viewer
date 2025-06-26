document.getElementById('vcardFile').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const rawContent = e.target.result;
            const contacts = parseVCard(rawContent);
            displayContactsInTable(contacts);
            // For debugging, also show raw content
            // const vcardContentDiv = document.getElementById('vcardRawContent');
            // vcardContentDiv.textContent = rawContent;
        };
        reader.readAsText(file);
    }
});

function parseVCard(rawContent) {
    const contacts = [];
    const lines = rawContent.split(/\r\n|\r|\n/);
    let currentContact = null;

    lines.forEach(line => {
        if (line.toUpperCase() === 'BEGIN:VCARD') {
            currentContact = {};
        } else if (line.toUpperCase() === 'END:VCARD') {
            if (currentContact) {
                contacts.push(currentContact);
                currentContact = null;
            }
        } else if (currentContact) {
            const parts = line.split(':');
            if (parts.length >= 2) {
                const keyPart = parts[0];
                const value = parts.slice(1).join(':');

                // Basic parsing for common fields
                // FN (Formatted Name)
                if (keyPart.startsWith('FN')) {
                    currentContact.fn = value;
                }
                // TEL (Telephone)
                else if (keyPart.startsWith('TEL')) {
                    // Simplistic approach: take the first TEL found
                    if (!currentContact.tel) currentContact.tel = value;
                }
                // EMAIL
                else if (keyPart.startsWith('EMAIL')) {
                     // Simplistic approach: take the first EMAIL found
                    if (!currentContact.email) currentContact.email = value;
                }
                // ORG (Organization)
                else if (keyPart.startsWith('ORG')) {
                    currentContact.org = value;
                }
            }
        }
    });
    return contacts;
}

function displayContactsInTable(contacts) {
    const tableBody = document.getElementById('contactsTableBody');
    if (!tableBody) {
        console.error('Table body not found!');
        return;
    }
    tableBody.innerHTML = ''; // Clear previous entries

    if (contacts.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4; // Number of columns
        cell.textContent = 'No contacts found in the VCard file.';
        return;
    }

    contacts.forEach(contact => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = contact.fn || 'N/A';
        row.insertCell().textContent = contact.tel || 'N/A';
        row.insertCell().textContent = contact.email || 'N/A';
        row.insertCell().textContent = contact.org || 'N/A';
    });
}
