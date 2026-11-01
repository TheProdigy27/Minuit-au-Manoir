// Interface dessinée par-dessus la vue 3D : crânes, équipe, lampe, messages, repères vers les amis
// à terre et la sortie, plan du manoir, et l'apparition de la créature quand elle vous attrape.
import { CFG } from '/shared/config.js';
import { TAU, FONT, TITLE, circle } from './art.js';

function text(c, str, x, y, size, color, align = 'left', font = FONT) {
  c.font = `${Math.round(size)}px ${font}`;
  c.textAlign = align;
  c.lineWidth = Math.max(2, size * 0.18);
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineJoin = 'round';
  c.strokeText(str, x, y);
  c.fillStyle = color;
  c.fillText(str, x, y);
}

function skullIcon(c, x, y, s, found, t) {
  c.save();
  c.translate(x, y);
  c.scale(s / 2, s / 2);
  c.globalAlpha = found ? 1 : 0.3;
  c.fillStyle = '#e9e4d4';
  c.beginPath(); c.arc(0, -0.15, 0.78, Math.PI * 0.8, Math.PI * 2.2); c.lineTo(0.42, 0.75); c.lineTo(-0.42, 0.75); c.closePath();
  c.fill();
  circle(c, -0.3, -0.05, 0.22, '#102010');
  circle(c, 0.3, -0.05, 0.22, '#102010');
  if (found) {
    const glow = 0.6 + 0.4 * Math.sin(t * 3);
    circle(c, -0.3, -0.05, 0.1, `rgba(125,255,154,${glow})`);
    circle(c, 0.3, -0.05, 0.1, `rgba(125,255,154,${glow})`);
  }
  c.restore();
}

function ring(c, x, y, r, k, width, color) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * k);
  c.stroke();
}

const MSG_COLORS = { red: '255,90,80', green: '140,255,160', big: '255,220,170', dim: '200,190,175', '': '232,220,200' };

export class Hud {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.plan = null;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = (this.w = this.cv.width = Math.round(innerWidth * dpr));
    const h = (this.h = this.cv.height = Math.round(innerHeight * dpr));
    this.u = Math.max(Math.min(w, h) / 700, dpr * 0.9);
  }

  // Le plan est teinté une fois pour toutes (un filtre à chaque image, touche M maintenue, coûtait cher).
  setMap(map, plan) {
    this.map = map;
    const cv = (this.plan = document.createElement('canvas'));
    cv.width = plan.width;
    cv.height = plan.height;
    const c = cv.getContext('2d');
    c.filter = 'sepia(0.55) brightness(0.85)';
    c.drawImage(plan, 0, 0);
  }

  draw(G, view) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.w, this.h);
    c.textBaseline = 'middle';
    if (G.showPlan) this.drawPlan(G);
    else {
      this.labels(G, view);
      this.panel(G);
    }
    if (G.jumpscare > 0) this.scare(G);
    if (G.needClick && !G.showPlan) {
      const u = this.u;
      c.fillStyle = 'rgba(5,3,6,0.55)';
      c.fillRect(0, this.h / 2 - 44 * u, this.w, 88 * u);
      text(c, 'Cliquez pour reprendre', this.w / 2, this.h / 2 - 10 * u, 26 * u, 'rgba(255,225,190,0.95)', 'center', TITLE);
      text(c, 'La souris sert à regarder autour de vous · Échap : menu', this.w / 2, this.h / 2 + 22 * u, 14 * u, 'rgba(232,220,200,0.75)', 'center');
    }
  }

  // Repère au-dessus d'un point du manoir ; hors du champ de vision, une flèche au bord de l'écran
  // indique de quel côté se tourner.
  marker(view, x, y, height, color, icon, label, progress = 0) {
    const c = this.ctx, u = this.u, w = this.w, h = this.h, m = 48 * u;
    const s = view.project(x, y, height, w, h);
    if (!s.behind && s.x > m && s.x < w - m && s.y > m && s.y < h - m) {
      text(c, icon, s.x, s.y, 22 * u, color, 'center');
      if (label) text(c, label, s.x, s.y - 22 * u, 12 * u, color, 'center');
      if (progress > 0) ring(c, s.x, s.y, 16 * u, progress, 3 * u, 'rgba(140,255,160,0.9)');
      return;
    }
    let dx = s.cx, dy = -s.cy * (s.behind ? 0.25 : 1);
    if (Math.hypot(dx, dy) < 1e-3) { dx = 0; dy = 1; }
    const cx = w / 2, cy = h / 2;
    const k = Math.min((cx - m) / Math.max(Math.abs(dx), 1e-6), (cy - m) / Math.max(Math.abs(dy), 1e-6));
    const ax = cx + dx * k, ay = cy + dy * k, ang = Math.atan2(dy, dx);
    c.save();
    c.translate(ax, ay);
    c.rotate(ang);
    c.fillStyle = color;
    c.beginPath(); c.moveTo(15 * u, 0); c.lineTo(-8 * u, -10 * u); c.lineTo(-8 * u, 10 * u); c.closePath(); c.fill();
    c.restore();
    const tag = label ? `${icon} ${label}` : icon;
    c.font = `${Math.round(13 * u)}px ${FONT}`;
    const half = c.measureText(tag).width / 2 + 10 * u;
    text(c, tag, Math.max(half, Math.min(w - half, ax)), ay + (ay > h / 2 ? -26 : 26) * u, 13 * u, color, 'center');
  }

  labels(G, view) {
    const c = this.ctx, u = this.u, t = G.time, me = G.me, eye = G.view, ghost = me?.state === 'dead';
    const active = me?.state === 'alive' || ghost;
    for (const id of G.order) {
      const p = G.players.get(id);
      if (!p || p === eye.who) continue;
      const d = Math.hypot(p.x - eye.x, p.y - eye.y);
      if (p.state === 'alive' || (p.state === 'dead' && ghost)) {
        const s = view.project(p.x, p.y, 2.0, this.w, this.h);
        if (s.behind || d > 20) continue;
        const a = 0.65 * (1 - d / 20);
        text(c, p.name, s.x, s.y, 12 * u, p.state === 'dead' ? `rgba(190,210,255,${a})` : `rgba(232,220,200,${a})`, 'center');
      } else if (p.state === 'down') {
        const pulse = 0.6 + 0.4 * Math.sin(t * 6);
        const label = `${p.name} · ${p.downT} s · ${Math.round(d)} m`;
        if (active) this.marker(view, p.x, p.y, 0.7, `rgba(255,70,60,${pulse})`, '✚', label, p.revive);
        else {
          const s = view.project(p.x, p.y, 0.7, this.w, this.h);
          if (!s.behind) text(c, `✚ ${label}`, s.x, s.y, 13 * u, `rgba(255,120,110,${pulse})`, 'center');
        }
      }
    }
    if (G.exitOpen && me && (me.state === 'alive' || me.state === 'down')) {
      const ex = G.map.exit;
      this.marker(view, ex.x + ex.w / 2, ex.y + 0.5, 1.4, 'rgba(140,255,160,0.95)', '🚪', `SORTIE · ${Math.round(Math.hypot(ex.x + 1 - eye.x, ex.y - eye.y))} m`);
    }
    for (const p of G.pings) this.marker(view, p.x, p.y, 1.4, `rgba(170,200,255,${Math.min(1, p.t / 2) * 0.85})`, '👻', '');
  }

  panel(G) {
    const c = this.ctx, u = this.u, w = this.w, h = this.h, t = G.time, me = G.me;

    // Viseur et progression de la réanimation
    if (me?.state === 'alive' && !G.needClick && !G.showPlan) circle(c, w / 2, h / 2, 1.6 * u, 'rgba(240,228,205,0.45)');
    if (me?.state === 'down' && me.revive > 0) ring(c, w / 2, h / 2, 40 * u, me.revive, 5 * u, 'rgba(140,255,160,0.9)');
    else if (G.reviveTarget && G.local.act && G.reviveTarget.revive > 0) ring(c, w / 2, h / 2, 30 * u, G.reviveTarget.revive, 4 * u, 'rgba(140,255,160,0.9)');

    // Crânes
    const n = G.skullsTotal, sz = 26 * u, gap = 8 * u;
    let x = w / 2 - (n * sz + (n - 1) * gap) / 2 + sz / 2;
    for (let i = 0; i < n; i++) { skullIcon(c, x, 26 * u, sz, i < G.skullsFound, t); x += sz + gap; }
    c.globalAlpha = 1;
    if (G.exitOpen) text(c, 'La grande porte est ouverte : FUYEZ !', w / 2, 58 * u, 18 * u, `rgba(140,255,160,${0.75 + 0.25 * Math.sin(t * 6)})`, 'center');
    else if (G.time < CFG.monster.dormant) text(c, `La créature dort encore… ${Math.ceil(CFG.monster.dormant - G.time)} s`, w / 2, 58 * u, 15 * u, 'rgba(232,220,200,0.75)', 'center');

    // Messages
    let my = 86 * u;
    for (const m of G.messages) {
      const a = Math.min(1, m.t), big = m.kind === 'big';
      text(c, m.text, w / 2, my, (big ? 22 : 16) * u, `rgba(${MSG_COLORS[m.kind] || MSG_COLORS['']},${a})`, 'center', big ? TITLE : FONT);
      my += (big ? 32 : 23) * u;
    }

    // Équipe
    let ty = 22 * u;
    for (const id of G.order) {
      const p = G.players.get(id);
      if (!p) continue;
      circle(c, 18 * u, ty, 6 * u, p.color);
      const status = p.disc && p.state !== 'escaped' && p.state !== 'dead' ? 'déconnecté·e'
        : p.state === 'down' ? `à terre · ${p.downT} s`
        : p.state === 'dead' ? 'mort·e' : p.state === 'escaped' ? 'dehors !' : p.room || '';
      const col = p.state === 'down' ? 'rgba(255,110,100,1)' : p.state === 'dead' ? 'rgba(150,150,160,0.8)' : p.state === 'escaped' ? 'rgba(140,255,160,0.95)' : 'rgba(232,220,200,0.9)';
      const name = p.name + (p === me ? ' (toi)' : '');
      text(c, name, 30 * u, ty, 14 * u, col);
      c.font = `${Math.round(14 * u)}px ${FONT}`;
      text(c, status, 38 * u + c.measureText(name).width, ty, 12 * u, 'rgba(200,190,175,0.7)');
      ty += 22 * u;
    }

    // Lampe et endurance
    if (me && me.state === 'alive') {
      const bx = w - 150 * u, by = 18 * u, bw = 52 * u, bh = 22 * u;
      const b = me.battery, low = b < 20;
      const col = b > 50 ? '#e8e0a0' : b > 20 ? '#e8b040' : '#e04030';
      c.globalAlpha = low && Math.sin(t * 8) > 0 ? 0.45 : 1;
      c.strokeStyle = col;
      c.lineWidth = 2 * u;
      c.strokeRect(bx, by, bw, bh);
      c.fillStyle = col;
      c.fillRect(bx + bw, by + bh * 0.3, 4 * u, bh * 0.4);
      c.fillRect(bx + 3 * u, by + 3 * u, (bw - 6 * u) * (b / 100), bh - 6 * u);
      c.globalAlpha = 1;
      text(c, G.local.light ? `${b} %` : 'éteinte', bx + bw + 12 * u, by + bh / 2, 15 * u, col);
      if (G.local.stamina < CFG.player.stamina - 0.01) {
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(bx, by + bh + 8 * u, 120 * u, 5 * u);
        c.fillStyle = G.local.exhausted ? '#a04030' : '#d8d0c0';
        c.fillRect(bx, by + bh + 8 * u, 120 * u * (G.local.stamina / CFG.player.stamina), 5 * u);
      }
    }
    if (G.focusRoom) text(c, G.focusRoom, w - 18 * u, 70 * u, 15 * u, 'rgba(232,220,200,0.6)', 'right');

    // Indication contextuelle
    let hint = '';
    if (me) {
      if (me.state === 'alive') {
        if (G.reviveTarget) hint = `Maintenez E pour relever ${G.reviveTarget.name}`;
        else if (me.battery <= 0) hint = 'Votre lampe est morte… trouvez des piles !';
        else if (!G.local.light) hint = 'Lampe éteinte : la créature vous voit moins (F pour rallumer)';
        else if (me.battery < 20) hint = 'Les piles faiblissent…';
        else if (G.time < 14) hint = 'Souris : regarder · ZQSD : se déplacer · Maj : courir · M : plan du manoir';
      } else if (me.state === 'down') hint = `Vous êtes à terre ! Rampez vers vos amis, ils peuvent vous relever (${me.downT} s)`;
      else if (me.state === 'dead') hint = 'Vous êtes un fantôme. E : laisser un signe aux vivants';
      else if (me.state === 'escaped') hint = G.spectating ? `Vous avez fui le manoir ! Vous suivez ${G.spectating.name} · clic pour changer` : 'Vous avez fui le manoir !';
    } else hint = 'Partie en cours : vous jouerez à la prochaine manche.';
    if (hint) text(c, hint, w / 2, h - 28 * u, 17 * u, 'rgba(240,228,205,0.92)', 'center');
  }

  // Plan du manoir (touche M maintenue) : les pièces, vous et vos amis. Ni la créature ni les crânes.
  drawPlan(G) {
    const c = this.ctx, u = this.u, w = this.w, h = this.h, map = this.map, plan = this.plan;
    if (!plan) return;
    c.fillStyle = 'rgba(5,3,6,0.85)';
    c.fillRect(0, 0, w, h);
    const s = Math.min((w * 0.9) / map.w, (h * 0.78) / map.h);
    const x0 = (w - map.w * s) / 2, y0 = (h - map.h * s) / 2 + 14 * u;
    c.drawImage(plan, x0, y0, map.w * s, map.h * s);
    c.strokeStyle = 'rgba(232,220,200,0.35)';
    c.lineWidth = 2 * u;
    c.strokeRect(x0, y0, map.w * s, map.h * s);
    text(c, 'Plan du manoir', w / 2, y0 - 26 * u, 28 * u, 'rgba(255,225,190,0.95)', 'center', TITLE);
    const P = (x, y) => [x0 + x * s, y0 + y * s];
    const ex = map.exit, [exX, exY] = P(ex.x + ex.w / 2, ex.y + 0.5);
    text(c, G.exitOpen ? '🚪 SORTIE' : '🚪', exX, exY + 4 * u, 14 * u, G.exitOpen ? 'rgba(140,255,160,1)' : 'rgba(200,170,255,0.9)', 'center');
    for (const id of G.order) {
      const p = G.players.get(id);
      if (!p || p === G.me || (p.state !== 'alive' && p.state !== 'down')) continue;
      const [px, py] = P(p.x, p.y);
      if (p.state === 'down') text(c, '✚', px, py, 18 * u, 'rgba(255,70,60,1)', 'center');
      else circle(c, px, py, 5 * u, p.color);
      text(c, p.name, px, py - 13 * u, 11 * u, 'rgba(232,220,200,0.9)', 'center');
    }
    const me = G.me;
    if (me && me.state !== 'escaped') {
      const L = G.local, [px, py] = P(L.x, L.y);
      c.save();
      c.translate(px, py);
      c.rotate(L.a);
      c.fillStyle = me.color;
      c.strokeStyle = '#000';
      c.lineWidth = 2 * u;
      c.beginPath(); c.moveTo(11 * u, 0); c.lineTo(-7 * u, -7 * u); c.lineTo(-3 * u, 0); c.lineTo(-7 * u, 7 * u); c.closePath();
      c.stroke();
      c.fill();
      c.restore();
      text(c, 'Vous', px, py - 15 * u, 12 * u, 'rgba(255,240,215,1)', 'center');
    }
  }

  // Apparition de la créature en plein écran quand elle vous attrape
  scare(G) {
    const c = this.ctx, w = this.w, h = this.h, k = 1 - G.jumpscare;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (k < 0.08) { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); return; }
    c.fillStyle = `rgba(0,0,0,${Math.min(0.92, G.jumpscare * 1.4)})`;
    c.fillRect(0, 0, w, h);
    const s = Math.min(w, h) * (0.55 + 0.45 * Math.min(1, k * 2.2));
    c.save();
    c.translate(w / 2 + (Math.random() - 0.5) * 30 * this.u, h / 2 + (Math.random() - 0.5) * 30 * this.u);
    c.scale(s / 2, s / 2);
    c.globalAlpha = Math.min(1, G.jumpscare * 2);
    const g = c.createRadialGradient(0, -0.2, 0.1, 0, 0, 1);
    g.addColorStop(0, '#d8d0c0');
    g.addColorStop(0.7, '#8a8478');
    g.addColorStop(1, '#2a2622');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, -0.95);
    c.bezierCurveTo(0.6, -0.95, 0.72, -0.3, 0.6, 0.2);
    c.bezierCurveTo(0.5, 0.65, 0.25, 1, 0, 1);
    c.bezierCurveTo(-0.25, 1, -0.5, 0.65, -0.6, 0.2);
    c.bezierCurveTo(-0.72, -0.3, -0.6, -0.95, 0, -0.95);
    c.fill();
    c.fillStyle = '#050304';
    for (const sgn of [-1, 1]) { c.beginPath(); c.ellipse(sgn * 0.25, -0.2, 0.17, 0.23, sgn * 0.25, 0, TAU); c.fill(); }
    for (const sgn of [-1, 1]) circle(c, sgn * 0.24, -0.17, 0.035, '#ff1a10');
    c.fillStyle = '#050304';
    c.beginPath(); c.moveTo(-0.05, 0.08); c.lineTo(0, 0); c.lineTo(0.05, 0.08); c.fill();
    c.beginPath(); c.ellipse(0, 0.48, 0.3, 0.3 + 0.05 * Math.sin(G.time * 40), 0, 0, TAU); c.fill();
    c.fillStyle = '#d8d0b8';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + 0.25 + (i / 8) * (Math.PI - 0.5);
      const px = Math.cos(a) * 0.29, py = 0.48 + Math.sin(a) * 0.29;
      c.beginPath(); c.moveTo(px - 0.03, py); c.lineTo(px + 0.03, py); c.lineTo(px, py + 0.09); c.fill();
      const qx = Math.cos(-a) * 0.29, qy = 0.48 + Math.sin(-a) * 0.29;
      c.beginPath(); c.moveTo(qx - 0.03, qy); c.lineTo(qx + 0.03, qy); c.lineTo(qx, qy - 0.09); c.fill();
    }
    c.strokeStyle = 'rgba(30,10,10,0.6)';
    c.lineWidth = 0.012;
    c.beginPath(); c.moveTo(0.1, -0.95); c.lineTo(0.18, -0.6); c.lineTo(0.12, -0.45); c.moveTo(-0.4, 0.1); c.lineTo(-0.5, 0.35); c.stroke();
    c.restore();
    c.globalAlpha = 1;
    c.fillStyle = `rgba(160,0,0,${0.25 * G.jumpscare})`;
    c.fillRect(0, 0, w, h);
  }
}
