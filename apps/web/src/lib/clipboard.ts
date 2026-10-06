/**
 * Copies text to the clipboard. Falls back to a hidden text area where the Clipboard API is
 * missing, as on a page served over plain HTTP, or where the browser refuses it.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the text area.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}
