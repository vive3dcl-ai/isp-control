(function () {
  var cfg = window.ISP_LANDING || {}
  var panelUrl = String(cfg.panelUrl || 'https://panel.ispcontrol.ai').replace(
    /\/?$/,
    '',
  )
  var apiUrl = String(cfg.apiUrl || '/api').replace(/\/?$/, '')
  var loginUrl = panelUrl + '/login'

  function setHref(id, href) {
    var el = document.getElementById(id)
    if (el) el.setAttribute('href', href)
  }

  setHref('nav-login', loginUrl)
  setHref('foot-login', loginUrl)

  var year = document.getElementById('year')
  if (year) year.textContent = '© ' + new Date().getFullYear() + ' ISP Control'

  function queryPlan() {
    try {
      return new URLSearchParams(window.location.search).get('plan') || ''
    } catch (_) {
      return ''
    }
  }

  function slugify(name) {
    return String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  function money(n) {
    if (n == null || !isFinite(Number(n))) return ''
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

  function showError(msg) {
    var el = document.getElementById('register-error')
    if (!el) return
    el.hidden = !msg
    el.textContent = msg || ''
  }

  function setBusy(busy) {
    var btn = document.getElementById('register-submit')
    var form = document.getElementById('register-form')
    if (btn) {
      btn.disabled = !!busy
      btn.textContent = busy ? 'Creando cuenta…' : 'Crear cuenta'
    }
    if (form) {
      form.setAttribute('aria-busy', busy ? 'true' : 'false')
    }
  }

  function parseApiError(data, status) {
    if (!data) return 'No se pudo completar el registro (HTTP ' + status + ').'
    if (typeof data.message === 'string') return data.message
    if (Array.isArray(data.message) && data.message.length) {
      return data.message.join(' · ')
    }
    if (typeof data.error === 'string' && data.message) return String(data.message)
    return 'No se pudo completar el registro.'
  }

  var slugTouched = false
  var nameInput = document.getElementById('name')
  var slugInput = document.getElementById('slug')
  if (nameInput && slugInput) {
    nameInput.addEventListener('input', function () {
      if (!slugTouched) slugInput.value = slugify(nameInput.value)
    })
    slugInput.addEventListener('input', function () {
      slugTouched = true
      slugInput.value = slugInput.value.toLowerCase()
    })
  }

  var planSelect = document.getElementById('planCode')
  var planHint = document.getElementById('plan-hint')
  var preferredPlan = queryPlan()

  function updatePlanHint() {
    if (!planSelect || !planHint) return
    var opt = planSelect.options[planSelect.selectedIndex]
    if (!opt || !opt.value) {
      planHint.hidden = true
      return
    }
    var free = opt.getAttribute('data-free') === '1'
    var lifetime = opt.getAttribute('data-lifetime') === '1'
    var price = opt.getAttribute('data-price')
    var limit = opt.getAttribute('data-limit')
    planHint.hidden = false
    planHint.textContent = free
      ? 'Plan gratis · hasta ' + limit + ' ONUs'
      : lifetime
        ? money(price) + ' USD pago único · hasta ' + limit + ' ONUs'
        : money(price) + ' USD / mes · hasta ' + limit + ' ONUs'
  }

  function fillPlans(plans) {
    if (!planSelect) return
    if (!plans.length) {
      planSelect.innerHTML = '<option value="">Sin planes disponibles</option>'
      return
    }
    planSelect.innerHTML = plans
      .map(function (p) {
        var free = !!p.isFree
        var lifetime = !!(p.isLifetime || p.code === 'lifetime')
        var label =
          (p.label || p.code) +
          (free
            ? ' — Gratis'
            : lifetime
              ? ' — ' + money(p.priceUsd) + ' pago único'
              : ' — ' + money(p.priceUsd) + '/mes')
        return (
          '<option value="' +
          String(p.code).replace(/"/g, '&quot;') +
          '" data-free="' +
          (free ? '1' : '0') +
          '" data-lifetime="' +
          (lifetime ? '1' : '0') +
          '" data-price="' +
          String(p.priceUsd != null ? p.priceUsd : '') +
          '" data-limit="' +
          String(p.userLimit != null ? p.userLimit : '') +
          '">' +
          label.replace(/</g, '&lt;') +
          '</option>'
        )
      })
      .join('')

    var codes = plans.map(function (p) {
      return p.code
    })
    if (preferredPlan && codes.indexOf(preferredPlan) >= 0) {
      planSelect.value = preferredPlan
    } else {
      var freePlan = plans.find(function (p) {
        return !!p.isFree
      })
      planSelect.value = (freePlan && freePlan.code) || plans[0].code
    }
    updatePlanHint()
  }

  if (planSelect) {
    planSelect.addEventListener('change', updatePlanHint)
  }

  fetch(apiUrl + '/public/platform/plans', { credentials: 'omit' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then(function (data) {
      fillPlans((data && data.plans) || [])
    })
    .catch(function () {
      fillPlans([
        {
          code: 'users_15',
          label: '15 usuarios',
          userLimit: 15,
          priceUsd: 49,
          isFree: true,
        },
        {
          code: 'users_50',
          label: '50 usuarios',
          userLimit: 50,
          priceUsd: 99,
          isFree: false,
        },
        {
          code: 'users_100',
          label: '100 usuarios',
          userLimit: 100,
          priceUsd: 179,
          isFree: false,
        },
        {
          code: 'users_200',
          label: '200 usuarios',
          userLimit: 200,
          priceUsd: 299,
          isFree: false,
        },
        {
          code: 'users_500',
          label: '500 usuarios',
          userLimit: 500,
          priceUsd: 499,
          isFree: false,
        },
      ])
      showError(
        'No se pudieron cargar los planes en vivo. Puedes continuar con la lista de referencia.',
      )
    })

  var form = document.getElementById('register-form')
  if (!form) return

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    showError('')

    var password = document.getElementById('ownerPassword').value
    var confirm = document.getElementById('ownerPasswordConfirm').value
    if (password !== confirm) {
      showError('Las contraseñas no coinciden.')
      return
    }
    if (!planSelect || !planSelect.value) {
      showError('Selecciona un plan.')
      return
    }
    if (!form.reportValidity()) return

    var payload = {
      name: document.getElementById('name').value.trim(),
      legalName: document.getElementById('legalName').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      address: document.getElementById('address').value.trim(),
      slug: document.getElementById('slug').value.trim().toLowerCase(),
      ownerName: document.getElementById('ownerName').value.trim(),
      ownerEmail: document.getElementById('ownerEmail').value.trim(),
      ownerPassword: password,
      ownerPasswordConfirm: confirm,
      planCode: planSelect.value,
      website: document.getElementById('website').value || '',
    }

    setBusy(true)
    fetch(apiUrl + '/public/platform/register', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(
          function (data) {
            return { ok: r.ok, status: r.status, data: data }
          },
          function () {
            return { ok: r.ok, status: r.status, data: null }
          },
        )
      })
      .then(function (res) {
        if (!res.ok) {
          showError(parseApiError(res.data, res.status))
          setBusy(false)
          return
        }
        var email =
          (res.data && res.data.owner && res.data.owner.email) ||
          payload.ownerEmail
        var next =
          loginUrl +
          '?registered=1&email=' +
          encodeURIComponent(email || '')
        window.location.href = next
      })
      .catch(function () {
        showError('Error de red. Intenta de nuevo en unos segundos.')
        setBusy(false)
      })
  })
})()
