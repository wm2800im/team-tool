// CONFIGURATION PRODUCTION — Firebase PROD
globalThis.COVOIT_ENV = {
  environment: "production",
  version: "4.5.0",
  vapidKey: "BDY_aON4z7uM561jtiX4WeQ7cWbagvuA0M7eP1c_b540_bXALoiwGEAsSvqVMWJwsRM5Jll6Gx6PwqX3eLleVSE",
  firebaseConfig: {
    apiKey: "AIzaSyB3PFq_lZZKyB4psesMmqB7vKEnVH1ASUM",
    authDomain: "team-tool-data.firebaseapp.com",
    projectId: "team-tool-data",
    storageBucket: "team-tool-data.firebasestorage.app",
    messagingSenderId: "994222139729",
    appId: "1:994222139729:web:79ac2f43b7a8e02be6cb70"
  }
};

// Aide express de production.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  const host = document.querySelector('.help-menu-block');
  if (!host) return;

  if (!document.getElementById('prod-help-styles')) {
    const style = document.createElement('style');
    style.id = 'prod-help-styles';
    style.textContent = `
      .help-shell > summary::-webkit-details-marker{display:none}
      .help-shell > summary{list-style:none}
      .help-summary-left{display:flex;align-items:center;gap:10px;min-width:0}
      .help-summary-icon{width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,#e9f2fb,#dceafb);display:grid;place-items:center;font-size:18px;flex:0 0 auto}
      .help-summary-text{display:flex;flex-direction:column;font:inherit;line-height:1.3}
      .help-summary-text strong{font:inherit;font-weight:800;letter-spacing:normal}.help-summary-text small{font-size:11px;color:var(--muted);font-weight:600;margin-top:3px}
      .help-summary-arrow{font-size:22px;color:var(--muted);transition:transform .18s ease}
      .help-shell[open] .help-summary-arrow{transform:rotate(90deg)}
      .help-panel{margin-top:12px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card)}
      .help-hero{padding:16px;background:linear-gradient(145deg,#203a5f,#315b88);color:#fff}
      .help-hero-kicker{font-size:11px;font-weight:850;letter-spacing:.7px;text-transform:uppercase;opacity:.8}
      .help-hero h4{font-size:19px;line-height:1.2;margin:5px 0 6px}
      .help-hero p{font-size:12px;line-height:1.45;margin:0;opacity:.9}
      .help-flow{display:grid;gap:8px;padding:12px}
      .help-step{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:start;padding:10px;border:1px solid var(--line);border-radius:11px;background:var(--soft)}
      .help-step-n{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--brand);color:#fff;font-weight:900;font-size:13px}
      .help-step strong{display:block;font-size:13px;margin-bottom:2px}
      .help-step span{display:block;font-size:11.5px;line-height:1.4;color:var(--muted)}
      .help-section{padding:13px 14px;border-top:1px solid var(--line)}
      .help-section-title{font-size:12px;font-weight:900;margin-bottom:9px;display:flex;align-items:center;gap:6px}
      .help-status-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .help-status{padding:8px 9px;border-radius:9px;border:1px solid var(--line);font-size:11px;line-height:1.3;background:var(--card)}
      .help-status strong{display:block;font-size:12px;margin-bottom:2px}
      .help-status.present strong{color:var(--ok)}
      .help-status.absent strong{color:var(--muted)}
      .help-status.alone strong{color:var(--brand2)}
      .help-status.time strong{color:var(--warn)}
      .help-highlight{padding:11px;border-radius:10px;background:#eef7ff;border:1px solid #cfe3f7;font-size:11.5px;line-height:1.45}
      .help-highlight strong{color:#203a5f}
      .help-tabs{display:grid;gap:6px}
      .help-tab{display:grid;grid-template-columns:86px 1fr;gap:8px;align-items:start;font-size:11.5px;line-height:1.35}
      .help-tab b{color:var(--brand)}
      .help-tip{margin-top:8px;padding:9px 10px;border-radius:9px;background:#eefaf4;border:1px solid #c9ead9;font-size:11.5px;line-height:1.4}
      html[data-theme="dark"] .help-summary-icon{background:#202b38}
      html[data-theme="dark"] .help-highlight{background:#17283a;border-color:#2e4d6a}
      html[data-theme="dark"] .help-highlight strong{color:#a9ccec}
      html[data-theme="dark"] .help-tip{background:#13271f;border-color:#285a44}
    `;
    document.head.appendChild(style);
  }

  host.innerHTML = `
    <details class="help-shell">
      <summary class="menu-link">
        <span class="help-summary-left">
          <span class="help-summary-icon">💡</span>
          <span class="help-summary-text"><strong>Aide express</strong><small>1 minute pour tout comprendre</small></span>
        </span>
        <span class="help-summary-arrow">›</span>
      </summary>

      <div class="help-panel">
        <div class="help-hero">
          <div class="help-hero-kicker">Le principe</div>
          <h4>Tu renseignes ta situation.<br>L’app fait le reste.</h4>
          <p>Elle compose les groupes, tient compte des contraintes et aide à faire tourner les conducteurs équitablement.</p>
        </div>

        <div class="help-flow">
          <div class="help-step"><div class="help-step-n">1</div><div><strong>Je renseigne ma journée</strong><span>Présent, absent, seul ou avec un impératif horaire.</span></div></div>
          <div class="help-step"><div class="help-step-n">2</div><div><strong>L’app propose les groupes</strong><span>Elle croise les disponibilités, les contraintes et l’historique.</span></div></div>
          <div class="help-step"><div class="help-step-n">3</div><div><strong>On valide le trajet réel</strong><span>Chaque groupe peut être validé ou modifié séparément. Le vrai conducteur est enregistré et les compteurs sont mis à jour.</span></div></div>
        </div>

        <div class="help-section">
          <div class="help-section-title">👆 Quel statut choisir ?</div>
          <div class="help-status-grid">
            <div class="help-status present"><strong>● Présent</strong>Je covoiture normalement.</div>
            <div class="help-status absent"><strong>○ Absent</strong>Je ne participe pas.</div>
            <div class="help-status alone"><strong>🚗 Seul</strong>Je fais mon trajet de mon côté.</div>
            <div class="help-status time"><strong>⏱ Impératif</strong>Je dois repartir à une heure précise.</div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">⚖️ Comment le conducteur est choisi ?</div>
          <div class="help-highlight"><strong>Chaque composition a son propre compteur.</strong><br>Un binôme Igor–Ludo est équilibré séparément d’un trinôme Igor–Ludo–Stéphane. L’app suggère en priorité celui qui a le moins conduit dans cette composition.</div>
          <div class="help-tip">✅ Si quelqu’un d’autre conduit finalement, on sélectionne simplement le <strong>conducteur réel</strong> avant validation.</div>
        </div>

        <div class="help-section">
          <div class="help-section-title">⏱ Et si j’ai un impératif ?</div>
          <div class="small muted">Tu indiques ton heure. Les collègues concernés disent s’ils peuvent s’adapter. L’app évite alors de proposer un groupe incompatible.</div>
        </div>

        <div class="help-section">
          <div class="help-section-title">🧭 Les 4 onglets</div>
          <div class="help-tabs">
            <div class="help-tab"><b>Prochain</b><span>Ma saisie et la situation du prochain covoiturage.</span></div>
            <div class="help-tab"><b>Planning</b><span>Renseigner plusieurs jours rapidement.</span></div>
            <div class="help-tab"><b>Groupes</b><span>Préparer, ajuster ou corriger les groupes.</span></div>
            <div class="help-tab"><b>Historique</b><span>Voir les trajets et mon bilan personnel.</span></div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">🔔 Petit plus</div>
          <div class="small muted">Si les notifications sont activées, un rappel peut être envoyé à 20h quand le prochain jour travaillé n’est pas encore renseigné.</div>
        </div>

      </div>
    </details>
  `;
});
