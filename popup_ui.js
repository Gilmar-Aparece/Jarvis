const keyInput = document.getElementById('key');
const msg = document.getElementById('msg');

chrome.storage.local.get(['geminiApiKey'], (res) => {
  if (res.geminiApiKey) {
    keyInput.value = res.geminiApiKey;
    msg.textContent = 'Key loaded. Jarvis is armed.';
    msg.style.color = '#5bff9a';
  }
});

document.getElementById('save').addEventListener('click', () => {
  const value = keyInput.value.trim();
  if (!value) {
    msg.textContent = 'Enter a key first.';
    msg.style.color = '#ff5c5c';
    return;
  }
  chrome.storage.local.set({ geminiApiKey: value }, () => {
    msg.textContent = 'Saved. Reload open tabs to apply.';
    msg.style.color = '#5bff9a';
  });
});
