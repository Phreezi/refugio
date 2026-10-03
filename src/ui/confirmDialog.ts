import { PALETTE } from '../assets/palette';

// Pergunta com dois botões em DOM (por cima de qualquer cena: o convite do co-op pode chegar
// no menu, num jogo ou no mapa-mundo). Só há uma de cada vez.

let open: HTMLDivElement | null = null;

export function confirmDialog(text: string, yes: string, no: string): Promise<boolean> {
  open?.remove();
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1100',
      background: 'rgba(20, 14, 18, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: PALETTE.night,
      border: `3px solid ${PALETTE.bark_dark}`,
      color: PALETTE.cream,
      font: '24px "Jersey 10", monospace',
      padding: '16px',
      maxWidth: '420px',
      textAlign: 'center',
      lineHeight: '1.2',
    });
    const message = document.createElement('p');
    message.textContent = text;
    Object.assign(message.style, { margin: '0 0 16px' });
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '12px', justifyContent: 'center' });
    const button = (label: string, primary: boolean, value: boolean): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        font: '24px "Jersey 10", monospace',
        color: PALETTE.cream,
        background: primary ? PALETTE.wood : PALETTE.shadow,
        border: `2px solid ${PALETTE.bark_dark}`,
        padding: '6px 16px',
        minWidth: '110px',
        minHeight: '44px',
        cursor: 'pointer',
      });
      b.addEventListener('click', () => {
        backdrop.remove();
        if (open === backdrop) open = null;
        resolve(value);
      });
      return b;
    };
    row.append(button(no, false, false), button(yes, true, true));
    box.append(message, row);
    backdrop.append(box);
    document.body.append(backdrop);
    open = backdrop;
  });
}
