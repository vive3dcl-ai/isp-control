(function () {
  var cfg = window.ISP_LANDING || {}
  var panelUrl = String(cfg.panelUrl || 'https://panel.ispcontrol.ai').replace(
    /\/?$/,
    '',
  )
  var apiUrl = String(cfg.apiUrl || '/api').replace(/\/?$/, '')
  var contactEmail = String(cfg.contactEmail || 'hola@ispcontrol.ai')
  var loginUrl = panelUrl + '/login'
  var registerUrl = String(cfg.registerUrl || loginUrl)

  function setHref(id, href) {
    var el = document.getElementById(id)
    if (el) el.setAttribute('href', href)
  }

  ;[
    ['nav-login', loginUrl],
    ['cta-login', loginUrl],
    ['cta-bottom-login', loginUrl],
    ['cta-start', registerUrl],
    ['nav-register', '#planes'],
    ['cta-register', '#planes'],
    ['cta-contact', 'mailto:' + contactEmail],
  ].forEach(function (pair) {
    setHref(pair[0], pair[1])
  })

  var host = document.getElementById('panel-host')
  if (host) {
    try {
      host.textContent = new URL(panelUrl).host
    } catch (_) {
      host.textContent = panelUrl.replace(/^https?:\/\//, '')
    }
  }

  var year = document.getElementById('year')
  if (year) year.textContent = '© ' + new Date().getFullYear()

  function money(n) {
    if (n == null || !isFinite(Number(n))) return '—'
    try {
      return new Intl.NumberFormat('es', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(Number(n))
    } catch (_) {
      return '$' + Number(n).toFixed(0)
    }
  }

  function showStatus(msg) {
    var el = document.getElementById('plans-status')
    if (!el) return
    el.hidden = !msg
    el.textContent = msg || ''
  }

  function renderPlans(data) {
    var list = document.getElementById('plans-list')
    if (!list) return
    var plans = (data && data.plans) || []
    var blockSize = (data && data.extraBlockSize) || 50
    var blockPrice = data && data.extraBlockPriceUsd

    var blockCopy = document.getElementById('block-copy')
    if (blockCopy) {
      blockCopy.textContent =
        'Cada bloque suma +' +
        blockSize +
        ' ONUs al cupo. Valor del bloque: ' +
        money(blockPrice) +
        '/mes · se configura desde el panel.'
    }

    if (!plans.length) {
      list.innerHTML = ''
      showStatus('Los planes se cargarán cuando el API esté disponible.')
      return
    }

    showStatus('')
    list.innerHTML = plans
      .map(function (p) {
        var limit = p.userLimit != null ? p.userLimit : '—'
        var label = p.label || limit + ' usuarios'
        return (
          '<li class="plan">' +
          '<div>' +
          '<p class="plan-name">' +
          escapeHtml(label) +
          '</p>' +
          '<p class="plan-meta">Cupo ' +
          escapeHtml(String(limit)) +
          ' ONUs · mensual</p>' +
          '</div>' +
          '<div class="plan-price">' +
          money(p.priceUsd) +
          '<small>USD / mes</small></div>' +
          '<a class="plan-cta" href="' +
          escapeAttr(registerUrl) +
          '">Empezar</a>' +
          '</li>'
        )
      })
      .join('')
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;')
  }

  function loadPlans() {
    var url = apiUrl + '/public/platform/plans'
    fetch(url, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(renderPlans)
      .catch(function () {
        renderPlans({
          plans: [
            { code: 'users_15', label: '15 usuarios', userLimit: 15, priceUsd: 49 },
            { code: 'users_50', label: '50 usuarios', userLimit: 50, priceUsd: 99 },
            { code: 'users_100', label: '100 usuarios', userLimit: 100, priceUsd: 179 },
            { code: 'users_200', label: '200 usuarios', userLimit: 200, priceUsd: 299 },
            { code: 'users_500', label: '500 usuarios', userLimit: 500, priceUsd: 499 },
          ],
          extraBlockSize: 50,
          extraBlockPriceUsd: 40,
        })
        showStatus(
          'Mostrando precios de referencia. Conecta el API para valores en vivo del panel.',
        )
      })
  }

  loadPlans()
})()
