export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  let link: HTMLAnchorElement | null = null;

  try {
    link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
  } finally {
    link?.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
