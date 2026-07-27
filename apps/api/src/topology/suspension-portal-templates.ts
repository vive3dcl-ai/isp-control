/** Built-in HTML templates for the captive suspension portal. */

export type SuspensionPortalTemplateMeta = {
  id: string;
  name: string;
  description: string;
};

export type SuspensionPortalTemplateVars = {
  brand: string;
  logoHtml: string;
  phone: string;
  email: string;
  contactHtml: string;
  message: string;
};

export const SUSPENSION_PORTAL_TEMPLATE_IDS = [
  'midnight',
  'aurora',
  'ocean',
  'forest',
  'ember',
  'noir',
  'cloud',
  'sand',
  'indigo',
  'mint',
] as const;

export type SuspensionPortalTemplateId =
  (typeof SUSPENSION_PORTAL_TEMPLATE_IDS)[number];

export const DEFAULT_SUSPENSION_PORTAL_TEMPLATE: SuspensionPortalTemplateId =
  'midnight';

export const SUSPENSION_PORTAL_TEMPLATES: SuspensionPortalTemplateMeta[] = [
  {
    id: 'midnight',
    name: 'Medianoche',
    description: 'Oscuro, tipografía clara, acento rojo suave',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Gradiente teal/cyan con vidrio esmerilado',
  },
  {
    id: 'ocean',
    name: 'Océano',
    description: 'Azules profundos y ondas suaves',
  },
  {
    id: 'forest',
    name: 'Bosque',
    description: 'Verdes naturales y tarjeta clara',
  },
  {
    id: 'ember',
    name: 'Brasa',
    description: 'Oscuro con acentos ámbar',
  },
  {
    id: 'noir',
    name: 'Noir',
    description: 'Negro elegante con detalle dorado',
  },
  {
    id: 'cloud',
    name: 'Nube',
    description: 'Claro, minimalista y aireado',
  },
  {
    id: 'sand',
    name: 'Arena',
    description: 'Tonos arena y tipografía serif suave',
  },
  {
    id: 'indigo',
    name: 'Índigo',
    description: 'Índigo profundo con brillo lateral',
  },
  {
    id: 'mint',
    name: 'Menta',
    description: 'Fresco, menta y blanco limpio',
  },
];

function isTemplateId(id: string): id is SuspensionPortalTemplateId {
  return (SUSPENSION_PORTAL_TEMPLATE_IDS as readonly string[]).includes(id);
}

export function resolveSuspensionPortalTemplateId(
  raw: string | null | undefined,
): SuspensionPortalTemplateId {
  if (raw && isTemplateId(raw)) return raw;
  return DEFAULT_SUSPENSION_PORTAL_TEMPLATE;
}

function shell(
  title: string,
  css: string,
  body: string,
): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderSuspensionPortalTemplate(
  templateId: string,
  vars: SuspensionPortalTemplateVars,
): string {
  const id = resolveSuspensionPortalTemplateId(templateId);
  const title = `Servicio suspendido — ${vars.brand}`;
  switch (id) {
    case 'midnight':
      return shell(title, CSS_MIDNIGHT, bodyMidnight(vars));
    case 'aurora':
      return shell(title, CSS_AURORA, bodyAurora(vars));
    case 'ocean':
      return shell(title, CSS_OCEAN, bodyOcean(vars));
    case 'forest':
      return shell(title, CSS_FOREST, bodyForest(vars));
    case 'ember':
      return shell(title, CSS_EMBER, bodyEmber(vars));
    case 'noir':
      return shell(title, CSS_NOIR, bodyNoir(vars));
    case 'cloud':
      return shell(title, CSS_CLOUD, bodyCloud(vars));
    case 'sand':
      return shell(title, CSS_SAND, bodySand(vars));
    case 'indigo':
      return shell(title, CSS_INDIGO, bodyIndigo(vars));
    case 'mint':
      return shell(title, CSS_MINT, bodyMint(vars));
    default:
      return shell(title, CSS_MIDNIGHT, bodyMidnight(vars));
  }
}

function bodyMidnight(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <section class="card">
      ${v.logoHtml}
      <span class="badge">Servicio suspendido</span>
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyAurora(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <div class="orb o1"></div>
    <div class="orb o2"></div>
    <section class="glass">
      ${v.logoHtml}
      <p class="kicker">Acceso restringido</p>
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyOcean(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <div class="wave"></div>
    <section class="panel">
      ${v.logoHtml}
      <h1>${v.brand}</h1>
      <div class="line"></div>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyForest(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <section class="card">
      <div class="top">
        ${v.logoHtml}
        <span class="pill">Suspendido</span>
      </div>
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyEmber(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <section class="card">
      <div class="glow"></div>
      ${v.logoHtml}
      <h1>${v.brand}</h1>
      <p class="label">Servicio temporalmente inactivo</p>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyNoir(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <section class="frame">
      ${v.logoHtml}
      <p class="eyebrow">Servicio suspendido</p>
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyCloud(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <section class="card">
      ${v.logoHtml}
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      <div class="box">
        <strong>¿Cómo reactivar?</strong>
        <span>Regulariza tu pago o contacta a soporte.</span>
      </div>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodySand(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <section class="sheet">
      ${v.logoHtml}
      <p class="tag">Aviso de servicio</p>
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyIndigo(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <aside class="rail"></aside>
    <section class="content">
      ${v.logoHtml}
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

function bodyMint(v: SuspensionPortalTemplateVars) {
  return `
  <main class="wrap">
    <section class="card">
      <div class="icon" aria-hidden="true">◎</div>
      ${v.logoHtml}
      <h1>${v.brand}</h1>
      <p class="msg">${v.message}</p>
      ${v.contactHtml}
    </section>
  </main>`;
}

const CSS_MIDNIGHT = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:'DM Sans',system-ui,sans-serif;background:#0b1220;color:#e8eef8}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:radial-gradient(1200px 600px at 10% -10%,#1e293b 0%,transparent 55%),radial-gradient(900px 500px at 100% 100%,#7f1d1d33 0%,transparent 50%),#0b1220}
.card{width:min(440px,100%);text-align:center;padding:44px 32px;border-radius:20px;background:linear-gradient(180deg,#151d2e,#101826);border:1px solid #2a364c;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.card img{max-height:72px;max-width:220px;object-fit:contain;margin:0 auto 18px;display:block}
.badge{display:inline-block;margin-bottom:16px;padding:6px 12px;border-radius:999px;background:#7f1d1d;color:#fecaca;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
h1{margin:0 0 12px;font-size:1.55rem;letter-spacing:-.02em}
.msg{margin:0;line-height:1.55;color:#9aa8c0;font-size:15px}
.contact{margin-top:28px;color:#7e8ba3;font-size:13px}
`;

const CSS_AURORA = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Sora,system-ui,sans-serif;background:#041016;color:#ecfeff}
.wrap{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;overflow:hidden;background:linear-gradient(145deg,#03151c,#062a32 40%,#0b3b36)}
.orb{position:absolute;border-radius:50%;filter:blur(40px);opacity:.55}
.o1{width:340px;height:340px;background:#14b8a6;top:-80px;left:-60px}
.o2{width:280px;height:280px;background:#06b6d4;bottom:-60px;right:-40px}
.glass{position:relative;width:min(460px,100%);text-align:center;padding:42px 30px;border-radius:24px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(16px);box-shadow:0 20px 50px rgba(0,0,0,.35)}
.glass img{max-height:70px;max-width:210px;object-fit:contain;margin:0 auto 16px;display:block}
.kicker{margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#99f6e4}
h1{margin:0 0 12px;font-size:1.6rem}
.msg{margin:0;color:#cbfbf1;line-height:1.55;font-size:15px}
.contact{margin-top:26px;color:#a5f3fc;font-size:13px}
`;

const CSS_OCEAN = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Outfit,system-ui,sans-serif;background:#06243a;color:#e6f4ff}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;position:relative;background:linear-gradient(180deg,#0a3350,#06243a 50%,#031824)}
.wave{position:absolute;inset:auto 0 0 0;height:38%;background:radial-gradient(120% 100% at 50% 0%,#0ea5e955 0%,transparent 70%);pointer-events:none}
.panel{position:relative;width:min(450px,100%);text-align:center;padding:40px 28px;border-radius:18px;background:#0c3a57ee;border:1px solid #1d5f86;box-shadow:0 18px 40px rgba(0,20,40,.45)}
.panel img{max-height:68px;max-width:200px;object-fit:contain;margin:0 auto 14px;display:block}
h1{margin:0;font-size:1.65rem}
.line{width:56px;height:3px;margin:14px auto 16px;border-radius:99px;background:#38bdf8}
.msg{margin:0;color:#b6d7ef;line-height:1.55;font-size:15px}
.contact{margin-top:24px;color:#7db7d8;font-size:13px}
`;

const CSS_FOREST = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Manrope,system-ui,sans-serif;background:#102418;color:#102418}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:linear-gradient(160deg,#163224,#0f2418 45%,#1a3d2a)}
.card{width:min(440px,100%);padding:36px 28px;border-radius:22px;background:#f4faf6;box-shadow:0 22px 50px rgba(0,0,0,.28)}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.card img{max-height:56px;max-width:160px;object-fit:contain;display:block}
.pill{padding:6px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
h1{margin:0 0 10px;font-size:1.55rem;color:#14532d}
.msg{margin:0;color:#3f5d4a;line-height:1.55;font-size:15px}
.contact{margin-top:22px;color:#4d6b5a;font-size:13px}
`;

const CSS_EMBER = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:'Space Grotesk',system-ui,sans-serif;background:#140c08;color:#fff7ed}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:radial-gradient(800px 420px at 80% 0%,#ea580c33,transparent 60%),#140c08}
.card{position:relative;overflow:hidden;width:min(440px,100%);text-align:center;padding:42px 30px;border-radius:18px;background:#1c120c;border:1px solid #3f2618}
.glow{position:absolute;inset:-40% auto auto 20%;width:220px;height:220px;background:#f97316;filter:blur(70px);opacity:.25;pointer-events:none}
.card img{position:relative;max-height:68px;max-width:200px;object-fit:contain;margin:0 auto 14px;display:block}
h1{position:relative;margin:0 0 8px;font-size:1.6rem}
.label{position:relative;margin:0 0 12px;color:#fdba74;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.msg{position:relative;margin:0;color:#d6b8a0;line-height:1.55;font-size:15px}
.contact{position:relative;margin-top:24px;color:#b08968;font-size:13px}
`;

const CSS_NOIR = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Inter,system-ui,sans-serif;background:#050505;color:#f5f5f4}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:linear-gradient(180deg,#0a0a0a,#050505)}
.frame{width:min(430px,100%);text-align:center;padding:44px 30px;border:1px solid #c9a22755;background:#0c0c0c;box-shadow:0 0 0 1px #000,0 30px 60px rgba(0,0,0,.55)}
.frame img{max-height:64px;max-width:190px;object-fit:contain;margin:0 auto 18px;display:block}
.eyebrow{margin:0 0 8px;color:#c9a227;font-size:11px;letter-spacing:.18em;text-transform:uppercase}
h1{margin:0 0 14px;font-family:'Cormorant Garamond',Georgia,serif;font-size:2.1rem;font-weight:700;letter-spacing:.01em}
.msg{margin:0;color:#a8a29e;line-height:1.6;font-size:15px}
.contact{margin-top:26px;color:#78716c;font-size:13px}
`;

const CSS_CLOUD = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#eef2f7;color:#0f172a}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:linear-gradient(180deg,#f8fafc,#e8eef6)}
.card{width:min(460px,100%);padding:40px 30px;border-radius:24px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 18px 40px rgba(15,23,42,.08);text-align:center}
.card img{max-height:68px;max-width:200px;object-fit:contain;margin:0 auto 16px;display:block}
h1{margin:0 0 10px;font-size:1.55rem}
.msg{margin:0 0 18px;color:#64748b;line-height:1.55;font-size:15px}
.box{text-align:left;padding:14px 16px;border-radius:14px;background:#f1f5f9;margin-bottom:8px}
.box strong{display:block;font-size:13px;margin-bottom:4px}
.box span{font-size:13px;color:#64748b}
.contact{margin-top:18px;color:#94a3b8;font-size:13px}
`;

const CSS_SAND = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Source+Sans+3:wght@400;600&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:'Source Sans 3',system-ui,sans-serif;background:#e7dcc8;color:#2b2118}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:radial-gradient(900px 500px at 50% -10%,#f3ead8,transparent 60%),#e7dcc8}
.sheet{width:min(440px,100%);padding:42px 32px;background:#faf6ee;border-radius:8px;box-shadow:0 16px 36px rgba(70,50,20,.12);text-align:center;border-top:4px solid #8b6914}
.sheet img{max-height:64px;max-width:190px;object-fit:contain;margin:0 auto 14px;display:block}
.tag{margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8b6914;font-weight:600}
h1{margin:0 0 12px;font-family:Fraunces,Georgia,serif;font-size:1.85rem}
.msg{margin:0;color:#5c4d3c;line-height:1.6;font-size:15px}
.contact{margin-top:24px;color:#8a7a66;font-size:13px}
`;

const CSS_INDIGO = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:'IBM Plex Sans',system-ui,sans-serif;background:#0b1020;color:#eef2ff}
.wrap{min-height:100vh;display:grid;grid-template-columns:10px 1fr;align-items:center;justify-items:center;padding:28px;background:linear-gradient(120deg,#0b1020,#12183a 55%,#0b1020)}
.rail{height:min(420px,70vh);width:10px;border-radius:99px;background:linear-gradient(180deg,#818cf8,#6366f1,#4338ca);justify-self:start;margin-left:clamp(12px,4vw,40px)}
.content{width:min(430px,100%);padding:36px 28px 36px 18px;text-align:left}
.content img{max-height:64px;max-width:180px;object-fit:contain;margin:0 0 18px;display:block}
h1{margin:0 0 12px;font-size:1.7rem;letter-spacing:-.02em}
.msg{margin:0;color:#c7d2fe;line-height:1.55;font-size:15px}
.contact{margin-top:24px;color:#a5b4fc;font-size:13px}
@media (max-width:520px){.wrap{grid-template-columns:1fr}.rail{display:none}.content{text-align:center}.content img{margin-left:auto;margin-right:auto}}
`;

const CSS_MINT = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&display=swap');
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Nunito,system-ui,sans-serif;background:#ecfdf5;color:#064e3b}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;background:radial-gradient(700px 400px at 20% 10%,#a7f3d0aa,transparent 55%),#ecfdf5}
.card{width:min(440px,100%);text-align:center;padding:40px 28px;border-radius:28px;background:#fff;border:1px solid #a7f3d0;box-shadow:0 16px 36px rgba(6,95,70,.1)}
.icon{width:48px;height:48px;margin:0 auto 12px;border-radius:16px;display:grid;place-items:center;background:#d1fae5;color:#059669;font-size:22px}
.card img{max-height:64px;max-width:190px;object-fit:contain;margin:0 auto 12px;display:block}
h1{margin:0 0 10px;font-size:1.6rem;font-weight:800}
.msg{margin:0;color:#3f7465;line-height:1.55;font-size:15px}
.contact{margin-top:22px;color:#5b8f7e;font-size:13px}
`;
