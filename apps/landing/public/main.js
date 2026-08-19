(function () {
  var cfg = window.ISP_LANDING || {}
  var panelUrl = String(cfg.panelUrl || 'https://panel.ispcontrol.ai').replace(
    /\/?$/,
    '',
  )
  var apiUrl = String(cfg.apiUrl || '/api').replace(/\/?$/, '')
  var contactEmail = String(cfg.contactEmail || 'hola@ispcontrol.ai')
  var loginUrl = panelUrl + '/login'
  // Registro siempre en el landing (el plan va por query).
  var registerUrl = '/register.html'

  function planRegisterHref(code) {
    return registerUrl + '?plan=' + encodeURIComponent(code || '')
  }
  var reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function setHref(id, href) {
    var el = document.getElementById(id)
    if (el) el.setAttribute('href', href)
  }

  ;[
    ['nav-login', loginUrl],
    ['cta-login', loginUrl],
    ['cta-bottom-login', loginUrl],
    ['cta-start', '#planes'],
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

  function isFreePlan(p) {
    return !!(p && p.isFree)
  }

  function planPerksHtml(p) {
    var limit = Number(p && p.userLimit)
    var perks = ['CRM, red y facturación', 'Mapa y campo incluidos']
    if (limit >= 200) {
      perks.push('Implementación completa')
      perks.push('Soporte prioritario')
    } else if (limit >= 50) {
      perks.push('Implementación inicial')
      perks.push('Soporte vía ticket')
    } else {
      perks.push('Soporte del panel')
    }
    return (
      '<ul class="plan-perks">' +
      perks.map(function (t) {
        return '<li>' + escapeHtml(t) + '</li>'
      }).join('') +
      '</ul>'
    )
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
        'Plan a tu medida: compra solo los usuarios que necesitas en bloques de ' +
        blockSize +
        ' ONUs y no gastes de más. Ideal cuando abres una zona nueva o un urbanismo sin saltar a un plan enorme.'
    }
    var blockMeta = document.getElementById('block-meta')
    if (blockMeta) {
      if (blockPrice != null && isFinite(Number(blockPrice))) {
        blockMeta.hidden = false
        blockMeta.textContent =
          'Cada bloque: +' +
          blockSize +
          ' ONUs · ' +
          money(blockPrice) +
          '/mes'
      } else {
        blockMeta.hidden = true
      }
    }

    if (!plans.length) {
      list.innerHTML = ''
      showStatus('Los planes se cargarán cuando el API esté disponible.')
      return
    }

    showStatus('')
    list.innerHTML = plans
      .map(function (p) {
        var free = isFreePlan(p)
        var limit = p.userLimit != null ? p.userLimit : '—'
        var label = p.label || limit + ' usuarios'
        var priceHtml = free
          ? '<div class="plan-price is-free">Gratis<small>por tiempo limitado</small></div>'
          : '<div class="plan-price">' +
            money(p.priceUsd) +
            '<small>USD / mes</small></div>'
        var ribbon = free
          ? '<span class="plan-ribbon" aria-hidden="true">Gratis</span>'
          : ''
        var cta = free ? 'Empezar gratis' : 'Elegir plan'
        return (
          '<li class="plan' +
          (free ? ' is-free' : '') +
          '">' +
          ribbon +
          '<p class="plan-name">' +
          escapeHtml(label) +
          '</p>' +
          '<p class="plan-meta">Hasta ' +
          escapeHtml(String(limit)) +
          ' ONUs</p>' +
          priceHtml +
          planPerksHtml(p) +
          '<a class="plan-cta' +
          (free ? ' is-primary' : '') +
          '" href="' +
          escapeAttr(planRegisterHref(p.code)) +
          '">' +
          cta +
          '</a>' +
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
            { code: 'users_15', label: '15 usuarios', userLimit: 15, priceUsd: 49, isFree: true },
            { code: 'users_50', label: '50 usuarios', userLimit: 50, priceUsd: 99, isFree: false },
            { code: 'users_100', label: '100 usuarios', userLimit: 100, priceUsd: 179, isFree: false },
            { code: 'users_200', label: '200 usuarios', userLimit: 200, priceUsd: 299, isFree: false },
            { code: 'users_500', label: '500 usuarios', userLimit: 500, priceUsd: 499, isFree: false },
          ],
          extraBlockSize: 50,
          extraBlockPriceUsd: 40,
        })
        showStatus(
          'Mostrando precios de referencia. Conecta el API para valores en vivo del panel.',
        )
      })
  }

  function animateCounts() {
    if (reduceMotion) {
      document.querySelectorAll('.count-up').forEach(function (el) {
        el.textContent = String(el.getAttribute('data-to') || '0')
      })
      return
    }
    document.querySelectorAll('.count-up').forEach(function (el) {
      var to = Number(el.getAttribute('data-to') || 0)
      var start = performance.now()
      var dur = 1100
      function frame(now) {
        var t = Math.min(1, (now - start) / dur)
        var eased = 1 - Math.pow(1 - t, 3)
        el.textContent = String(Math.round(to * eased))
        if (t < 1) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  }

  function initReveal() {
    var nodes = document.querySelectorAll('.reveal')
    if (!nodes.length) return
    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) {
        n.classList.add('is-visible')
      })
      return
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    nodes.forEach(function (n) {
      io.observe(n)
    })
  }

  function initFeatureTabs() {
    var tabs = Array.prototype.slice.call(
      document.querySelectorAll('.feature-tab'),
    )
    var panels = Array.prototype.slice.call(
      document.querySelectorAll('.feature-panel'),
    )
    var ink = document.getElementById('feature-tab-ink')
    if (!tabs.length || !panels.length) return

    var autoTimer = null
    var paused = false
    var order = tabs.map(function (t) {
      return t.getAttribute('data-tab')
    })

    function moveInk(tab) {
      if (!ink || !tab) return
      ink.style.width = tab.offsetWidth + 'px'
      ink.style.transform = 'translateX(' + tab.offsetLeft + 'px)'
    }

    function activate(id, user) {
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-tab') === id
        tab.classList.toggle('is-active', on)
        tab.setAttribute('aria-selected', on ? 'true' : 'false')
        tab.tabIndex = on ? 0 : -1
        if (on) moveInk(tab)
      })
      panels.forEach(function (panel) {
        var on = panel.getAttribute('data-panel') === id
        panel.removeAttribute('hidden')
        if (on) {
          panel.classList.remove('is-active')
          void panel.offsetWidth
          panel.classList.add('is-active')
          panel.setAttribute('aria-hidden', 'false')
        } else {
          panel.classList.remove('is-active')
          panel.setAttribute('aria-hidden', 'true')
        }
      })
      if (user) {
        paused = true
        stopAuto()
        window.setTimeout(function () {
          paused = false
          startAuto()
        }, 12000)
      }
    }

    function next() {
      var current = tabs.find(function (t) {
        return t.classList.contains('is-active')
      })
      var idx = current ? order.indexOf(current.getAttribute('data-tab')) : 0
      var nextId = order[(idx + 1) % order.length]
      activate(nextId, false)
    }

    function startAuto() {
      stopAuto()
      if (reduceMotion || paused) return
      autoTimer = window.setInterval(next, 5500)
    }

    function stopAuto() {
      if (autoTimer) {
        window.clearInterval(autoTimer)
        autoTimer = null
      }
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-tab'), true)
      })
      tab.addEventListener('keydown', function (ev) {
        var i = tabs.indexOf(tab)
        if (ev.key === 'ArrowRight') {
          ev.preventDefault()
          var r = tabs[(i + 1) % tabs.length]
          r.focus()
          activate(r.getAttribute('data-tab'), true)
        } else if (ev.key === 'ArrowLeft') {
          ev.preventDefault()
          var l = tabs[(i - 1 + tabs.length) % tabs.length]
          l.focus()
          activate(l.getAttribute('data-tab'), true)
        }
      })
    })

    var shell = document.querySelector('.feature-shell')
    if (shell) {
      shell.addEventListener('mouseenter', stopAuto)
      shell.addEventListener('mouseleave', function () {
        if (!paused) startAuto()
      })
    }

    window.addEventListener('resize', function () {
      var active = tabs.find(function (t) {
        return t.classList.contains('is-active')
      })
      moveInk(active || tabs[0])
    })

    activate(order[0] || 'crm', false)
    requestAnimationFrame(function () {
      moveInk(tabs[0])
    })
    startAuto()
  }

  loadPlans()
  animateCounts()
  initReveal()
  initFeatureTabs()
})()
