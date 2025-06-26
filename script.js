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
            const params = { TYPE: [] }; // Initialize TYPE as an array

            keyParts.slice(1).forEach(p => {
                const [paramName, ...paramValueParts] = p.split('=');
                const paramValue = paramValueParts.join('=');

                if (paramValueParts.length > 0) { // It's a key=value pair
                    if (paramName.toUpperCase() === 'TYPE') {
                        // TYPE can be comma-separated, e.g., TYPE=HOME,VOICE
                        paramValue.split(',').forEach(typeVal => {
                            if (!params.TYPE.includes(typeVal.toUpperCase())) {
                                params.TYPE.push(typeVal.toUpperCase());
                            }
                        });
                    } else {
                        params[paramName.toUpperCase()] = paramValue;
                    }
                } else { 
                    // No '=', so it's a V2.1 style type or other valueless param
                    // e.g., TEL;CELL or TEL;PREF (though PREF usually has =1 in V3)
                    // We'll assume valueless parameters are types for now, common in V2.1 for TEL/ADR/EMAIL
                    if (!params.TYPE.includes(paramName.toUpperCase())) {
                         params.TYPE.push(paramName.toUpperCase());
                    }
                }
            });
            
            // If params.TYPE is empty after processing, remove it
            if (params.TYPE.length === 0) {
                delete params.TYPE;
            }


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
        cell.colSpan = 4; // Updated to match new table structure (Full Name, Mobile, Email, Org)
        cell.textContent = 'No contacts found or VCard is empty/invalid.';
        return;
    }

    contacts.forEach(contact => {
        const row = tableBody.insertRow();

        // Full Name
        row.insertCell().textContent = constructFullName(contact);
        
        // Mobile Phone
        let mobilePhone = 'N/A';
        if (contact.tel && contact.tel.length > 0) {
            const mobileEntry = contact.tel.find(t => t.params && t.params.TYPE && t.params.TYPE.toUpperCase().includes('CELL'));
            if (mobileEntry) {
                mobilePhone = mobileEntry.value;
            }
        }
        row.insertCell().textContent = mobilePhone;

        // Primary Email
        let primaryEmail = 'N/A';
        if (contact.email && contact.email.length > 0) {
            // Prefer email with PREF=1 if available
            const prefEmail = contact.email.find(em => em.params && em.params.PREF === '1');
            if (prefEmail) {
                primaryEmail = prefEmail.value;
            } else {
                primaryEmail = contact.email[0].value; // Fallback to the first email
            }
        }
        row.insertCell().textContent = primaryEmail;
        
        // Organization
        row.insertCell().textContent = contact.org || 'N/A';
        
        // Add event listener to row for modal opening
        row.addEventListener('click', () => {
            populateModal(contact);
            modal.style.display = 'block';
        });
    });
}

// --- Modal Logic ---
const modal = document.getElementById('contactModal');
const closeButton = document.querySelector('.close-button');

if (modal && closeButton) {
    closeButton.onclick = function() {
        modal.style.display = 'none';
    }
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    }
} else {
    console.error("Modal or close button not found. Modal functionality will be affected.");
}


function constructFullName(contact) {
    if (contact.fn) { // Formatted Name usually preferred if available
        return contact.fn;
    }
    if (contact.n) { // Structured Name
        const parts = [contact.n.prefix, contact.n.given, contact.n.middle, contact.n.family, contact.n.suffix];
        return parts.filter(Boolean).join(' ').trim(); // Filter out empty parts and join
    }
    return 'N/A'; // Fallback
}

function populateModal(contact) {
    // Name Details
    // Helper to get property value, handling potential array structure
    function getPropertyValue(prop) {
        if (!prop) return 'N/A';
        return Array.isArray(prop) ? prop[0].value : prop.value;
    }
    
    function getPropertyParams(prop) {
        if (!prop) return {};
        return Array.isArray(prop) ? prop[0].params : prop.params;
    }

    // Helper to format YYYYMMDD to YYYY-MM-DD
    function formatDate(yyyymmdd) {
        if (!yyyymmdd || yyyymmdd.length !== 8) return 'N/A';
        return `${yyyymmdd.substring(0, 4)}-${yyyymmdd.substring(4, 6)}-${yyyymmdd.substring(6, 8)}`;
    }
    
    // Helper to format ADR components
    function formatAdr(adrValue) {
        if (!adrValue) return 'N/A';
        const parts = adrValue.split(';');
        // Order: PO Box; Extended Addr; Street; Locality (City); Region (State); Postal Code; Country
        const labels = ["PO Box", "Extended Address", "Street", "City", "Region/State", "Postal Code", "Country"];
        let formatted = [];
        parts.forEach((part, index) => {
            if (part.trim() && labels[index]) {
                formatted.push(`<div><strong>${labels[index]}:</strong> ${part.trim()}</div>`);
            }
        });
        return formatted.length > 0 ? formatted.join('') : adrValue; // Fallback to raw if empty after parse
    }


    // --- Populate Name Details ---
    document.getElementById('modalFN').textContent = contact.fn || 'N/A';
    document.getElementById('modalFamilyName').textContent = contact.n && contact.n.family ? contact.n.family : 'N/A';
    document.getElementById('modalGivenName').textContent = contact.n && contact.n.given ? contact.n.given : 'N/A';
    document.getElementById('modalMiddleName').textContent = contact.n && contact.n.middle ? contact.n.middle : 'N/A';
    document.getElementById('modalPrefix').textContent = contact.n && contact.n.prefix ? contact.n.prefix : 'N/A';
    document.getElementById('modalSuffix').textContent = contact.n && contact.n.suffix ? contact.n.suffix : 'N/A';
    // NICKNAME
    const nicknameProp = contact.other && contact.other['NICKNAME'];
    document.getElementById('modalNickname').textContent = nicknameProp ? getPropertyValue(nicknameProp) : 'N/A';

    // --- Populate Personal Details ---
    const bdayProp = contact.other && contact.other['BDAY'];
    document.getElementById('modalBirthday').textContent = bdayProp ? formatDate(getPropertyValue(bdayProp)) : 'N/A';
    const anniversaryProp = contact.other && contact.other['ANNIVERSARY'];
    document.getElementById('modalAnniversary').textContent = anniversaryProp ? formatDate(getPropertyValue(anniversaryProp)) : 'N/A';
    const genderProp = contact.other && contact.other['GENDER'];
    document.getElementById('modalGender').textContent = genderProp ? getPropertyValue(genderProp) : 'N/A';
    
    // --- Populate Work/Organization ---
    document.getElementById('modalOrg').textContent = contact.org || 'N/A';
    const titleProp = contact.other && contact.other['TITLE'];
    document.getElementById('modalTitle').textContent = titleProp ? getPropertyValue(titleProp) : 'N/A';
    const roleProp = contact.other && contact.other['ROLE'];
    document.getElementById('modalRole').textContent = roleProp ? getPropertyValue(roleProp) : 'N/A';

    // --- Populate Phone Numbers ---
    const phonesList = document.getElementById('modalPhonesList');
    phonesList.innerHTML = ''; // Clear previous
    if (contact.tel && contact.tel.length > 0) {
        contact.tel.forEach(tel => {
            const li = document.createElement('li');
            let telDesc = tel.value;
            if (tel.params && tel.params.TYPE) {
                telDesc += ` (${tel.params.TYPE.split(',').join('/')})`;
            }
            li.textContent = telDesc;
            phonesList.appendChild(li);
        });
    } else {
        phonesList.innerHTML = '<li>N/A</li>';
    }

    // Email Addresses
    const emailsList = document.getElementById('modalEmailsList');
    emailsList.innerHTML = ''; // Clear previous
    if (contact.email && contact.email.length > 0) {
        contact.email.forEach(email => {
            const li = document.createElement('li');
            let emailDesc = email.value;
            if (email.params && email.params.TYPE) {
                emailDesc += ` (${email.params.TYPE.split(',').join('/')})`;
            }
            li.textContent = emailDesc;
            emailsList.appendChild(li);
        });
    } else {
        emailsList.innerHTML = '<li>N/A</li>';
    }

    // --- Populate Addresses ---
    const addressesList = document.getElementById('modalAddressesList');
    addressesList.innerHTML = '';
    if (contact.adr && contact.adr.length > 0) {
        contact.adr.forEach(adrEntry => {
            const li = document.createElement('li');
            let adrContent = '';
            
            // Try to find a LABEL that matches this ADR's type
            const adrType = adrEntry.params && adrEntry.params.TYPE ? (Array.isArray(adrEntry.params.TYPE) ? adrEntry.params.TYPE.join(',') : adrEntry.params.TYPE) : '';
            const labelProp = contact.other && contact.other['LABEL'];
            let matchingLabel = null;
            if (labelProp) {
                const labels = Array.isArray(labelProp) ? labelProp : [labelProp];
                matchingLabel = labels.find(lbl => {
                    const lblType = lbl.params && lbl.params.TYPE ? (Array.isArray(lbl.params.TYPE) ? lbl.params.TYPE.join(',') : lbl.params.TYPE) : '';
                    return lblType === adrType;
                });
            }

            if (matchingLabel) {
                adrContent += `<div><strong>Label (${adrType || 'General'}):</strong> ${matchingLabel.value}</div>`;
            }
            adrContent += formatAdr(adrEntry.value); // Use helper to format components
            if (adrEntry.params && adrEntry.params.TYPE) {
                 if(!matchingLabel) adrContent += `<div><small>Type: ${Array.isArray(adrEntry.params.TYPE) ? adrEntry.params.TYPE.join(', ') : adrEntry.params.TYPE}</small></div>`;
            }
            li.innerHTML = adrContent;
            addressesList.appendChild(li);
        });
    } else {
        addressesList.innerHTML = '<li>N/A</li>';
    }

    // --- Populate Websites/URLs ---
    const websitesList = document.getElementById('modalWebsitesList');
    websitesList.innerHTML = '';
    const urlProps = contact.other && contact.other['URL'];
    if (urlProps) {
        const urls = Array.isArray(urlProps) ? urlProps : [urlProps];
        urls.forEach(urlEntry => {
            const li = document.createElement('li');
            let urlDesc = `<a href="${urlEntry.value}" target="_blank">${urlEntry.value}</a>`;
            const urlType = urlEntry.params && urlEntry.params.TYPE ? (Array.isArray(urlEntry.params.TYPE) ? urlEntry.params.TYPE.join('/') : urlEntry.params.TYPE) : null;
            if (urlType) {
                urlDesc += ` (${urlType})`;
            }
            li.innerHTML = urlDesc;
            websitesList.appendChild(li);
        });
    }
    if (websitesList.children.length === 0) {
         websitesList.innerHTML = '<li>N/A</li>';
    }

    // --- Populate Social Profiles ---
    const socialProfilesList = document.getElementById('modalSocialProfilesList');
    socialProfilesList.innerHTML = '';
    const socialProps = contact.other && contact.other['X-SOCIALPROFILE'];
    if (socialProps) {
        const profiles = Array.isArray(socialProps) ? socialProps : [socialProps];
        profiles.forEach(profileEntry => {
            const li = document.createElement('li');
            const profileType = profileEntry.params && profileEntry.params.TYPE ? (Array.isArray(profileEntry.params.TYPE) ? profileEntry.params.TYPE[0] : profileEntry.params.TYPE) : 'Profile'; // Take first type if array
            // Some X-SOCIALPROFILE values include full URLs, others might be just usernames.
            // For simplicity, link if it looks like a URL, otherwise just display.
            let profileValue = profileEntry.value;
            if (profileValue.toLowerCase().startsWith('http') || profileValue.includes('.com') || profileValue.includes('.net') || profileValue.includes('/')) {
                 profileValue = `<a href="${profileValue.startsWith('http') ? profileValue : '//' + profileValue}" target="_blank">${profileEntry.value}</a>`;
            }
            li.innerHTML = `<strong>${profileType}:</strong> ${profileValue}`;
            socialProfilesList.appendChild(li);
        });
    }
     if (socialProfilesList.children.length === 0) {
         socialProfilesList.innerHTML = '<li>N/A</li>';
    }
    
    // --- Populate Notes ---
    const noteProp = contact.other && contact.other['NOTE'];
    document.getElementById('modalNote').textContent = noteProp ? getPropertyValue(noteProp) : 'N/A';
    document.getElementById('modalNote').style.whiteSpace = 'pre-wrap';


    // --- Populate Other Properties ---
    const otherPropertiesList = document.getElementById('modalOtherPropertiesList');
    otherPropertiesList.innerHTML = ''; // Clear previous
    let hasOther = false;
    const handledKeys = ['NICKNAME', 'BDAY', 'ANNIVERSARY', 'GENDER', 'TITLE', 'ROLE', 'LABEL', 'URL', 'NOTE', 'X-SOCIALPROFILE'];
    for (const key in contact.other) {
        if (handledKeys.includes(key.toUpperCase())) continue;

        const prop = contact.other[key];
        if (Array.isArray(prop)) {
            prop.forEach(pItem => {
                const li = document.createElement('li');
                li.textContent = `${key}: ${pItem.value} (${JSON.stringify(pItem.params)})`;
                otherPropertiesList.appendChild(li);
                hasOther = true;
            });
        } else {
            const li = document.createElement('li');
            li.textContent = `${key}: ${prop.value} (${JSON.stringify(prop.params)})`;
            otherPropertiesList.appendChild(li);
            hasOther = true;
        }
    }
    if (!hasOther) {
        otherPropertiesList.innerHTML = '<li>N/A</li>';
    }
}
