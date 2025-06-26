document.getElementById('vcardFile').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const rawContent = e.target.result;
            const contacts = parseVCard(rawContent);
            displayContactsInTable(contacts);
        };
        reader.readAsText(file); // Defaulting to UTF-8, VCard CHARSET can override
    }
});

function decodeQuotedPrintable(str, charset = 'UTF-8') {
    // Handle soft line breaks (= at the end of a line)
    str = str.replace(/=\r?\n/g, '');

    // Decode =XX hex sequences
    try {
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            if (str[i] === '=' && str[i+1] && str[i+2]) {
                const hex = str.substring(i+1, i+3);
                bytes.push(parseInt(hex, 16));
                i += 2;
            } else {
                bytes.push(str.charCodeAt(i));
            }
        }
        const byteArray = new Uint8Array(bytes);
        // Standard charsets like UTF-8, ISO-8859-1 are well supported
        // For others, TextDecoder might not work or might need a polyfill
        return new TextDecoder(charset).decode(byteArray);
    } catch (e) {
        console.error("Error decoding quoted-printable string:", e);
        // Fallback to a simpler replacement if TextDecoder fails or for basic cases
        return str.replace(/=([A-F0-9]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16)));
    }
}


function parseVCard(rawContent) {
    const contacts = [];
    // Handle line folding: join lines that start with a space or tab
    const foldedLines = rawContent.replace(/\r?\n[ \t]/g, '');
    const lines = foldedLines.split(/\r?\n|\r|\n/);

    let currentContact = null;

    lines.forEach(line => {
        if (line.trim() === '') return;
        if (line.toUpperCase() === 'BEGIN:VCARD') {
            currentContact = {
                tel: [],
                email: [],
                adr: [],
                other: {} // For all other properties
            };
        } else if (line.toUpperCase() === 'END:VCARD') {
            if (currentContact) {
                contacts.push(currentContact);
                currentContact = null;
            }
        } else if (currentContact) {
            let [fullKey, ...valueParts] = line.split(':');
            let value = valueParts.join(':');

            const keyParts = fullKey.split(';');
            const mainKey = keyParts[0].toUpperCase();
            const params = {};
            keyParts.slice(1).forEach(p => {
                const [paramName, paramValue] = p.split('=');
                params[paramName.toUpperCase()] = paramValue;
            });

            // Check for Quoted-Printable encoding
            if (params['ENCODING'] === 'QUOTED-PRINTABLE') {
                const charset = params['CHARSET'] || 'UTF-8';
                value = decodeQuotedPrintable(value, charset);
            }

            switch (mainKey) {
                case 'FN':
                    currentContact.fn = value;
                    break;
                case 'N':
                    // N:Family;Given;Middle;Prefix;Suffix
                    const nameParts = value.split(';');
                    currentContact.n = {
                        family: nameParts[0] || '',
                        given: nameParts[1] || '',
                        middle: nameParts[2] || '',
                        prefix: nameParts[3] || '',
                        suffix: nameParts[4] || ''
                    };
                    break;
                case 'TEL':
                    currentContact.tel.push({ value: value, params: params });
                    break;
                case 'EMAIL':
                    currentContact.email.push({ value: value, params: params });
                    break;
                case 'ORG':
                    currentContact.org = value.split(';')[0]; // Organization name, ignore department for now
                    break;
                case 'ADR':
                    currentContact.adr.push({ value: value, params: params });
                    break;
                // Add more common cases if needed, or they fall into 'other'
                default:
                    if (currentContact.other[mainKey]) {
                        if (!Array.isArray(currentContact.other[mainKey])) {
                            currentContact.other[mainKey] = [currentContact.other[mainKey]];
                        }
                        currentContact.other[mainKey].push({ value: value, params: params });
                    } else {
                        currentContact.other[mainKey] = { value: value, params: params };
                    }
                    break;
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

    if (!contacts || contacts.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        // Adjust colSpan when table structure is finalized in index.html
        cell.colSpan = 9; // Placeholder, update with actual number of columns
        cell.textContent = 'No contacts found or VCard is empty/invalid.';
        return;
    }

    contacts.forEach(contact => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = contact.fn || 'N/A';
        
        // Structured Name (N)
        row.insertCell().textContent = contact.n ? contact.n.family : 'N/A';
        row.insertCell().textContent = contact.n ? contact.n.given : 'N/A';

        // Phones - display first two, with types if available
        for (let i = 0; i < 2; i++) {
            const telCell = row.insertCell();
            if (contact.tel && contact.tel[i]) {
                let telStr = contact.tel[i].value;
                const type = contact.tel[i].params['TYPE'];
                if (type) telStr += ` (${type.split(',').join('/')})`; // Display multiple types e.g. (HOME/VOICE)
                telCell.textContent = telStr;
            } else {
                telCell.textContent = 'N/A';
            }
        }

        // Emails - display first two, with types if available
        for (let i = 0; i < 2; i++) {
            const emailCell = row.insertCell();
            if (contact.email && contact.email[i]) {
                let emailStr = contact.email[i].value;
                const type = contact.email[i].params['TYPE'];
                if (type) emailStr += ` (${type.split(',').join('/')})`;
                emailCell.textContent = emailStr;
            } else {
                emailCell.textContent = 'N/A';
            }
        }
        
        row.insertCell().textContent = contact.org || 'N/A';

        // Other Properties
        const otherCell = row.insertCell();
        let otherText = '';
        for (const key in contact.other) {
            const prop = contact.other[key];
            if (Array.isArray(prop)) {
                prop.forEach(pItem => {
                    otherText += `${key}: ${pItem.value} (${JSON.stringify(pItem.params)})\n`;
                });
            } else {
                 otherText += `${key}: ${prop.value} (${JSON.stringify(prop.params)})\n`;
            }
        }
        otherCell.textContent = otherText.trim() || 'N/A';
        otherCell.style.whiteSpace = 'pre-wrap'; // To respect newlines
    });
}
