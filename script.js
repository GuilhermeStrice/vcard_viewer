document.getElementById('vcardFile').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result;
            const vcardContentDiv = document.getElementById('vcardContent');
            // For now, just display the raw content.
            // We can implement more sophisticated parsing later.
            vcardContentDiv.textContent = content;
        };
        reader.readAsText(file);
    }
});
