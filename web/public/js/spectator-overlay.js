// Paint the gallery's DOM cues over its WebGL image, using their live layout.
// No DOM is injected into the viewer and no screen-sharing prompt is needed.
export function drawSpectatorOverlay(context) {
  const range = document.createRange();
  function paint(element) {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility !== 'visible' || !rect.width || !rect.height || Number(style.opacity) === 0) return;
    context.save(); context.globalAlpha *= Number(style.opacity);
    const radius = style.borderTopLeftRadius.endsWith('%') ? Math.min(rect.width, rect.height) / 2 : parseFloat(style.borderTopLeftRadius) || 0;
    context.beginPath(); context.roundRect(rect.x, rect.y, rect.width, rect.height, Math.min(radius, rect.width / 2, rect.height / 2));
    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') { context.fillStyle = style.backgroundColor; context.fill(); }
    const border = parseFloat(style.borderTopWidth);
    if (border) { context.lineWidth = border; context.strokeStyle = style.borderTopColor; context.stroke(); }
    if (['hidden', 'auto', 'scroll'].includes(style.overflowY) || ['hidden', 'auto', 'scroll'].includes(style.overflowX)) context.clip();
    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth) context.drawImage(element, rect.x, rect.y, rect.width, rect.height);
    if (element.matches('#session-title.warning')) {
      const before = getComputedStyle(element, '::before'), w = parseFloat(before.width), h = parseFloat(before.height);
      const x = rect.x + (rect.width - w) / 2, y = rect.y;
      context.fillStyle = before.backgroundColor; context.beginPath();
      context.moveTo(x + w / 2, y); context.lineTo(x + w, y + h); context.lineTo(x, y + h); context.closePath(); context.fill();
      context.fillStyle = before.color; context.font = `${before.fontWeight} ${before.fontSize} ${before.fontFamily}`;
      context.textAlign = 'center'; context.textBaseline = 'top'; context.fillText('!', x + w / 2, y + parseFloat(before.paddingTop));
    }
    context.fillStyle = style.color;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.textAlign = 'left'; context.textBaseline = 'alphabetic';
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    const metrics = context.measureText('Mg'), ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize) * .8;
    const descent = metrics.fontBoundingBoxDescent ?? parseFloat(style.fontSize) * .2;
    for (const node of element.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) { paint(node); continue; }
      if (node.nodeType !== Node.TEXT_NODE) continue;
      for (const word of node.textContent.matchAll(/\S+/g)) {
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        const bounds = range.getBoundingClientRect();
        if (!bounds.width || !bounds.height) continue;
        const text = style.textTransform === 'uppercase' ? word[0].toUpperCase() : style.textTransform === 'lowercase' ? word[0].toLowerCase() : word[0];
        context.fillText(text, bounds.x, bounds.y + (bounds.height - ascent - descent) / 2 + ascent);
      }
    }
    context.restore();
  }
  const roots = [...document.querySelectorAll('#session-overlay, #calm, #stage, #look-controls, #xr, #hud, #status')];
  roots.sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
  for (const element of roots) paint(element);
}
