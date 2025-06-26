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


function formatPhoneNumber(phoneNumberString) {
    if (!phoneNumberString || typeof phoneNumberString !== 'string' || phoneNumberString.trim() === 'N/A' || phoneNumberString.trim() === '') {
        return phoneNumberString; // Return original if it's not a usable string
    }
    try {
        // Attempt to parse the phone number.
        // No default country is provided, so it relies on the number being in international format (e.g., +12125552368)
        // or being a national number where the country can be easily inferred by the library (less reliable without a hint).
        const phoneNumber = new libphonenumber.parsePhoneNumberFromString(phoneNumberString);

        if (phoneNumber && phoneNumber.isValid()) {
            return phoneNumber.formatInternational(); // e.g., +1 212 555 2368
        } else {
            // If it's not valid or couldn't be parsed well, try AsYouType for partial formatting
            // This can sometimes make poorly formatted numbers a bit more readable.
            const formattedAsYouType = new libphonenumber.AsYouType().input(phoneNumberString);
            // AsYouType().input() might return an empty string if it processes everything and finds nothing valid,
            // or it might return a partially formatted string. Only use if it's different and not empty.
            if (formattedAsYouType && formattedAsYouType !== phoneNumberString) {
                return formattedAsYouType;
            }
            return phoneNumberString; // Fallback to original if not valid or AsYouType didn't help
        }
    } catch (error) {
        // console.error("Error formatting phone number:", phoneNumberString, error);
        return phoneNumberString; // Fallback to original string in case of an error
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
            const mobileEntry = contact.tel.find(t => 
                t.params && t.params.TYPE && Array.isArray(t.params.TYPE) && t.params.TYPE.includes('CELL')
            );
            if (mobileEntry) {
                mobilePhone = formatPhoneNumber(mobileEntry.value);
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

// --- Tab Navigation Logic ---
const tabButtons = document.querySelectorAll('.tab-button');
const tabPanes = document.querySelectorAll('.tab-pane');

function showPane(paneIdToShow) {
    tabPanes.forEach(pane => {
        pane.classList.remove('active-pane');
        // pane.style.display = 'none'; // Already handled by CSS .tab-pane
    });
    tabButtons.forEach(button => {
        button.classList.remove('active-tab-button');
    });

    const paneToShow = document.getElementById(paneIdToShow);
    if (paneToShow) {
        paneToShow.classList.add('active-pane');
        // paneToShow.style.display = 'block'; // Already handled by CSS .active-pane
    }

    // Find the button that corresponds to this paneId (e.g., 'parserView' -> 'parserTabButton')
    const buttonToActivate = document.getElementById(paneIdToShow.replace('View', 'TabButton'));
    if (buttonToActivate) {
        buttonToActivate.classList.add('active-tab-button');
    }
}

tabButtons.forEach(button => {
    button.addEventListener('click', function() {
        // Derive target pane ID from button ID e.g. "parserTabButton" -> "parserView"
        const targetPaneId = this.id.replace('TabButton', 'View');
        showPane(targetPaneId);
    });
});

// Initialize with the Parser tab active and set up other event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Tab initialization
    showPane('parserView');

    // Set Privacy Policy Effective Date
    const privacyEffectiveDateSpan = document.getElementById('privacyEffectiveDate');
    if (privacyEffectiveDateSpan) {
        const today = new Date();
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        privacyEffectiveDateSpan.textContent = today.toLocaleDateString(undefined, options); // Uses browser's default locale for formatting
    }

    // --- VCard Generator Logic ---
    console.log("Attempting to find generator elements within DOMContentLoaded...");
    const generateVcfButtonElem = document.getElementById('generateVcfButton');
    const vcfOutputTextareaElem = document.getElementById('vcfOutput'); 
    const downloadVcfButtonElem = document.getElementById('downloadVcfButton');

    console.log("generateVcfButton found:", generateVcfButtonElem);
    console.log("vcfOutputTextarea found:", vcfOutputTextareaElem);
    console.log("downloadVcfButton found:", downloadVcfButtonElem);

    // Element selection and event listener attachment for generator are inside DOMContentLoaded
    // const generateVcfButton = document.getElementById('generateVcfButton'); // Replaced by Elem version
    // const vcfOutputTextarea = document.getElementById('vcfOutput');  // Replaced by Elem version
    // const downloadVcfButton = document.getElementById('downloadVcfButton'); // Replaced by Elem version

    if (generateVcfButtonElem && vcfOutputTextareaElem) {
        generateVcfButtonElem.addEventListener('click', function() { // Use Elem version
            if (document.getElementById('vcardGeneratorForm').checkValidity()) {
                const vcfString = generateVCardString();
                vcfOutputTextareaElem.value = vcfString; // Use Elem version
            } else {
                alert("Please fill in all required fields (Formatted Name).");
                document.getElementById('vcardGeneratorForm').reportValidity();
            }
        });
    } else {
        // These console errors will now only appear if the elements are truly missing from HTML
        // or if this script somehow runs before even the generator tab's HTML is parsed (unlikely with DOMContentLoaded)
        if (!generateVcfButtonElem) console.error("Generate VCF button ('generateVcfButton') not found in HTML.");
        if (!vcfOutputTextareaElem && generateVcfButtonElem) console.error("VCF Output textarea ('vcfOutput') not found in HTML.");
    }

    if (downloadVcfButton && vcfOutputTextarea) {
        downloadVcfButtonElem.addEventListener('click', function() { // Use Elem version
            const vcfString = vcfOutputTextareaElem.value; // Use Elem version
            if (!vcfString) {
                alert("Please generate a VCard first.");
                return;
            }

            let filename = "contact.vcf";
            const fnValue = document.getElementById('genFN') ? document.getElementById('genFN').value.trim() : '';
            if (fnValue) {
                filename = fnValue.replace(/[^a-z0-9_ \.\-]/gi, '_') + ".vcf";
            }

            const blob = new Blob([vcfString], { type: 'text/vcard;charset=utf-8;' });
            const link = document.createElement("a");
            if (link.download !== undefined) {
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                alert("Your browser doesn't support direct download. Please copy the VCard content manually.");
            }
        });
    } else {
        // Corrected the condition here to check downloadVcfButtonElem
        if (!downloadVcfButtonElem && generateVcfButtonElem) console.error("Download VCF button ('downloadVcfButton') not found in HTML.");
    }
});

// --- Modal Logic (Parser's Modal) ---
// These are for the parser's modal and should be available once the initial HTML is parsed.
// They are not inside DOMContentLoaded because functions like displayContactsInTable (which sets up row listeners)
// might be called before DOMContentLoaded if a file is processed very quickly or if the script is deferred weirdly.
// However, standard practice is that these too would be safer inside, or their usage deferred.
// For now, this matches the structure that was working for the modal previously.
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
    // This error means the fundamental modal structure for the parser is missing.
    console.error("Parser's Modal ('contactModal') or its close button not found. Modal functionality will be affected.");
}


// --- VCard Generator Logic ---
const generateVcfButton = document.getElementById('generateVcfButton');
const vcfOutputTextarea = document.getElementById('vcfOutput');

function generateUUID() { // Basic UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getCurrentTimestampUTC() {
    const now = new Date();
    return now.getUTCFullYear() +
        ('0' + (now.getUTCMonth() + 1)).slice(-2) +
        ('0' + now.getUTCDate()).slice(-2) + 'T' +
        ('0' + now.getUTCHours()).slice(-2) +
        ('0' + now.getUTCMinutes()).slice(-2) +
        ('0' + now.getUTCSeconds()).slice(-2) + 'Z';
}


function generateVCardString() {
    const vcfData = [];
    vcfData.push('BEGIN:VCARD');
    vcfData.push('VERSION:3.0');

    // Helper to add property if value exists
    function addProperty(property, value, params = {}) {
        if (value) {
            let line = property;
            if (Object.keys(params).length > 0) {
                for (const key in params) {
                    if(params[key]) { // Ensure param value is not empty
                         line += `;${key}=${params[key]}`;
                    }
                }
            }
            vcfData.push(`${line}:${value}`);
        }
    }
    
    // Helper to get form value
    function getFormValue(id) {
        const element = document.getElementById(id);
        return element ? element.value.trim() : '';
    }

    // Name
    const fn = getFormValue('genFN');
    addProperty('FN;CHARSET=UTF-8', fn);

    const nValues = [
        getFormValue('genFamilyName'),
        getFormValue('genGivenName'),
        getFormValue('genMiddleName'),
        getFormValue('genPrefix'),
        getFormValue('genSuffix')
    ];
    if (nValues.some(v => v)) { // Only add N if at least one part exists
        addProperty('N;CHARSET=UTF-8', nValues.join(';'));
    }
    addProperty('NICKNAME;CHARSET=UTF-8', getFormValue('genNickname'));

    // Personal Details
    addProperty('GENDER', getFormValue('genGender'));
    const bday = getFormValue('genBday');
    if (bday) addProperty('BDAY', bday.replace(/-/g, '')); // Convert YYYY-MM-DD to YYYYMMDD
    const anniversary = getFormValue('genAnniversary');
    if (anniversary) addProperty('ANNIVERSARY', anniversary.replace(/-/g, ''));

    // Work/Organization
    addProperty('ORG;CHARSET=UTF-8', getFormValue('genOrg'));
    addProperty('TITLE;CHARSET=UTF-8', getFormValue('genTitle'));
    addProperty('ROLE;CHARSET=UTF-8', getFormValue('genRole'));

    // Phone 1
    const phone1 = getFormValue('genPhone1');
    const phone1Type = getFormValue('genPhone1Type');
    if (phone1) {
        addProperty(`TEL;TYPE=${phone1Type}`, phone1);
    }

    // Email 1
    const email1 = getFormValue('genEmail1');
    const email1Type = getFormValue('genEmail1Type');
     if (email1) {
        addProperty(`EMAIL;CHARSET=UTF-8;TYPE=${email1Type}`, email1);
    }

    // Address 1
    const adr1Street = getFormValue('genAdr1Street');
    const adr1City = getFormValue('genAdr1City');
    const adr1State = getFormValue('genAdr1State');
    const adr1Postal = getFormValue('genAdr1Postal');
    const adr1Country = getFormValue('genAdr1Country');
    const adr1Type = getFormValue('genAdr1Type');
    const adr1Label = getFormValue('genAdr1Label');

    if (adr1Street || adr1City || adr1State || adr1Postal || adr1Country) {
        // ADR: PO Box; Extended Address; Street Address; Locality; Region; Postal Code; Country
        const adrValue = `;;${adr1Street};${adr1City};${adr1State};${adr1Postal};${adr1Country}`;
        addProperty(`ADR;CHARSET=UTF-8;TYPE=${adr1Type}`, adrValue);
    }
    if (adr1Label) {
         addProperty(`LABEL;CHARSET=UTF-8;TYPE=${adr1Type}`, adr1Label);
    }
    
    // Online Presence
    const url1 = getFormValue('genUrl1');
    const url1Type = getFormValue('genUrl1Type');
    if (url1) {
        addProperty(url1Type ? `URL;TYPE=${url1Type.toUpperCase()}` : 'URL', url1);
    }

    const social1Type = getFormValue('genSocial1Type');
    const social1Value = getFormValue('genSocial1Value');
    if (social1Type && social1Value) {
        addProperty(`X-SOCIALPROFILE;TYPE=${social1Type.toLowerCase()}`, social1Value);
    }
    
    // Note
    addProperty('NOTE;CHARSET=UTF-8', getFormValue('genNote'));
    
    // Auto-generated fields
    addProperty('UID', generateUUID());
    addProperty('REV', getCurrentTimestampUTC());

    vcfData.push('END:VCARD');
    return vcfData.join('\r\n'); // Standard VCF line ending
}


if (generateVcfButton) {
    generateVcfButton.addEventListener('click', function() {
        if (document.getElementById('vcardGeneratorForm').checkValidity()) {
            const vcfString = generateVCardString();
            if (vcfOutputTextarea) {
                vcfOutputTextarea.value = vcfString;
            }
        } else {
            // Optionally, provide more specific feedback or rely on browser's default validation UI
            alert("Please fill in all required fields (Formatted Name).");
            document.getElementById('vcardGeneratorForm').reportValidity();
        }
    });
} else {
    console.error("Generate VCF button not found.");
}

const downloadVcfButton = document.getElementById('downloadVcfButton');

if (downloadVcfButton) {
    downloadVcfButton.addEventListener('click', function() {
        const vcfString = vcfOutputTextarea ? vcfOutputTextarea.value : '';
        if (!vcfString) {
            alert("Please generate a VCard first.");
            return;
        }

        // Try to get a filename from FN, otherwise use a default
        let filename = "contact.vcf";
        const fnValue = document.getElementById('genFN') ? document.getElementById('genFN').value.trim() : '';
        if (fnValue) {
            filename = fnValue.replace(/[^a-z0-9_ \.\-]/gi, '_') + ".vcf"; // Sanitize filename
        }

        const blob = new Blob([vcfString], { type: 'text/vcard;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) { // feature detection
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } else {
            alert("Your browser doesn't support direct download. Please copy the VCard content manually.");
        }
    });
} else {
    console.error("Download VCF button not found.");
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
            let formattedNumber = formatPhoneNumber(tel.value);
            let telDesc = formattedNumber;
            
            if (tel.params && tel.params.TYPE && Array.isArray(tel.params.TYPE) && tel.params.TYPE.length > 0) {
                // Add type information, but try not to duplicate if formatting already includes it (though unlikely for simple types)
                const typeString = `(${tel.params.TYPE.join('/')})`;
                // Avoid adding empty parenthesis if no types
                if (typeString !== '()') {
                     telDesc += ` ${typeString}`;
                }
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
            if (email.params && email.params.TYPE && Array.isArray(email.params.TYPE)) { // Ensure it's an array
                emailDesc += ` (${email.params.TYPE.join('/')})`;
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
