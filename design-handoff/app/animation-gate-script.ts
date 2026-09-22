/**
 * app/animation-gate-script.ts — decisão antes da primeira pintura.
 *
 * O HTML do servidor sai sempre no estado final. Este script roda de forma
 * síncrona no <head>, antes de qualquer pintura, e escreve data-animate="on"
 * apenas quando a sessão e o slot permitem animar. Sem isso, o gráfico
 * apareceria no estado final e piscaria de volta para o início da animação.
 *
 * É a mesma lógica de lib/animation-gate.ts, escrita sem imports porque roda
 * antes do bundle. Qualquer mudança na regra precisa acontecer nos dois lugares;
 * o teste de lib/animation-gate.test.ts cobre as duas implementações com as
 * mesmas datas de fronteira (04:59, 05:00, 11:59, 12:00, 17:59, 18:00, 00:30).
 *
 * Uso em app/layout.tsx:
 *
 *   import { ANIMATION_GATE_SCRIPT } from './animation-gate-script'
 *   ...
 *   <head>
 *     <script dangerouslySetInnerHTML={{ __html: ANIMATION_GATE_SCRIPT }} />
 *   </head>
 *
 * O commit acontece no mesmo instante da decisão. Se a navegação for abortada
 * antes de qualquer gráfico aparecer, o slot é consumido de todo modo — o
 * inverso (animar duas vezes na mesma sessão) seria mais visível.
 */

export const ANIMATION_GATE_SCRIPT = `(function(){
  var root = document.documentElement;
  root.dataset.animate = 'off';
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var s = window.sessionStorage, l = window.localStorage;
    var probe = '__libero_probe__';
    s.setItem(probe, '1'); s.removeItem(probe);
    l.setItem(probe, '1'); l.removeItem(probe);

    if (s.getItem('libero.animated.session') === '1') return;

    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
    }).formatToParts(new Date());
    var get = function(t){ for (var i=0;i<parts.length;i++){ if (parts[i].type===t) return Number(parts[i].value); } return 0; };
    var y = get('year'), m = get('month'), d = get('day'), h = get('hour') % 24;
    var period = (h >= 5 && h < 12) ? 'manha' : (h >= 12 && h < 18) ? 'tarde' : 'noite';

    if (period === 'noite' && h < 5) {
      var shifted = new Date(Date.UTC(y, m - 1, d));
      shifted.setUTCDate(shifted.getUTCDate() - 1);
      y = shifted.getUTCFullYear(); m = shifted.getUTCMonth() + 1; d = shifted.getUTCDate();
    }
    var pad = function(v){ return v < 10 ? '0' + v : '' + v; };
    var slot = y + '-' + pad(m) + '-' + pad(d) + ':' + period;

    if (l.getItem('libero.animated.slot') === slot) return;

    s.setItem('libero.animated.session', '1');
    l.setItem('libero.animated.slot', slot);
    root.dataset.animate = 'on';
  } catch (e) {
    /* armazenamento indisponível: padrão seguro é o estado final */
  }
})();`;
