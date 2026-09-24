/** Descarrega texto como ficheiro (Exportar save). */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revogar logo pode cancelar o download em alguns browsers.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** Pede ao jogador um ficheiro de texto (Importar save). Resolve null se cancelar. */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(resolve, () => {
        resolve(null);
      });
    });
    input.addEventListener('cancel', () => {
      resolve(null);
    });
    input.click();
  });
}

/** Nome do ficheiro exportado: refugio-save-AAAA-MM-DD-HHMM.json (hora local). */
export function saveFileName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `refugio-save-${stamp}.json`;
}
