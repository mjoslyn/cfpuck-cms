// Forms: conditional logic (same rules as src/lib/forms/logic.ts), US phone formatting, character
// counters, the total of a form that takes payment (as src/lib/forms/payment.ts works it out; the
// server's is what is charged), and focus on the error summary or confirmation after a submission.
(function () {
  // Every field's value, those disabled because they are hidden included: whether they stay hidden is
  // worked out again from what is entered.
  function values(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === 'submit' || el.type === 'button' || ((el.type === 'checkbox' || el.type === 'radio') && !el.checked)) return;
      var k = el.name;
      var v = el.value;
      var m = k.match(/^([a-z0-9]+)(?:\[(\w*)\])?$/i);
      if (!m) return;
      var id = m[1];
      // A product's quantity isn't part of what its rules compare.
      if (m[2] === 'qty') return;
      if (m[2] === '') (out[id] = out[id] || []).push(String(v));
      else if (m[2]) out[id] = ((out[id] || '') + ' ' + v).trim();
      else out[id] = String(v);
    });
    return out;
  }

  function matches(op, actual, target) {
    var a = String(actual).trim().toLowerCase();
    var t = String(target || '').trim().toLowerCase();
    switch (op) {
      case 'is': return a === t;
      case 'isnot': return a !== t;
      case '>': return Number(actual) > Number(target);
      case '<': return Number(actual) < Number(target);
      case 'contains': return a.indexOf(t) !== -1;
      case 'starts_with': return a.indexOf(t) === 0;
      case 'ends_with': return a.slice(-t.length) === t;
    }
    return false;
  }

  function ruleMatches(rule, vals) {
    var v = vals[rule.field];
    var list = v == null ? [] : Array.isArray(v) ? v : [v];
    if (rule.op === 'isnot') return list.length ? list.every(function (x) { return matches('isnot', x, rule.value); }) : String(rule.value || '') !== '';
    return list.length ? list.some(function (x) { return matches(rule.op, x, rule.value); }) : matches(rule.op, '', rule.value);
  }

  // As hiddenFields in src/lib/forms/logic.ts: a hidden field counts as empty in other fields' rules,
  // however long the chain, and a field in a hidden section is hidden.
  function apply(form, logic) {
    var vals = values(form);
    var sections = {};
    var fields = {};
    form.querySelectorAll('[data-field]').forEach(function (el) {
      fields[el.getAttribute('data-field')] = true;
      if (el.getAttribute('data-section')) sections[el.getAttribute('data-field')] = el.getAttribute('data-section');
    });
    var memo = {};
    function hidden(id) {
      if (id in memo) return memo[id];
      // Rules that go round in a circle: a field met again on the way counts as shown.
      memo[id] = false;
      var l = logic[id];
      var result = false;
      if (l) {
        var results = l.rules.map(function (r) {
          var one = {};
          one[r.field] = fields[r.field] && hidden(r.field) ? undefined : vals[r.field];
          return ruleMatches(r, one);
        });
        var pass = l.match === 'any' ? results.some(Boolean) : results.every(Boolean);
        result = (l.action === 'show') !== pass;
      }
      if (!result && sections[id]) result = hidden(sections[id]);
      memo[id] = result;
      return result;
    }
    form.querySelectorAll('[data-field]').forEach(function (el) {
      var hide = hidden(el.getAttribute('data-field'));
      el.hidden = hide;
      // Hidden fields are not sent (the server ignores them either way).
      el.querySelectorAll('input, select, textarea').forEach(function (i) { i.disabled = hide; });
    });
  }

  function formatPhone(input) {
    var d = input.value.replace(/\D/g, '').slice(0, 10);
    var out = d;
    if (d.length > 6) out = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    else if (d.length > 3) out = '(' + d.slice(0, 3) + ') ' + d.slice(3);
    else if (d.length) out = '(' + d;
    input.value = out;
  }

  function counter(input) {
    var out = document.querySelector('[data-count-for="' + input.id + '"]');
    if (out) out.textContent = input.value.length + ' of ' + input.maxLength + ' characters';
  }

  // Products that conditional logic hides (or that sit in a hidden section) don't count.
  function total(form) {
    var sum = 0;
    form.querySelectorAll('.c-field.is-product').forEach(function (el) {
      if (el.hidden) return;
      var unit = 0;
      var amount = el.querySelector('[data-amount]');
      var select = el.querySelector('select');
      var radio = el.querySelector('input[type="radio"]:checked');
      var fixed = el.querySelector('p.c-product__price[data-price]');
      if (amount) unit = Math.round((parseFloat(amount.value) || 0) * 100);
      else if (select) unit = Number(select.options[select.selectedIndex] && select.options[select.selectedIndex].getAttribute('data-price')) || 0;
      else if (radio) unit = Number(radio.getAttribute('data-price')) || 0;
      else if (fixed) unit = Number(fixed.getAttribute('data-price')) || 0;
      var q = el.querySelector('[data-qty]');
      var qty = q ? Math.max(0, Math.floor(Number(q.value) || 0)) : 1;
      if (unit > 0) sum += unit * qty;
    });
    return sum;
  }

  function money(minor, currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(minor / 100);
    } catch (e) {
      return (minor / 100).toFixed(2) + ' ' + currency;
    }
  }

  function init() {
    document.querySelectorAll('.c-form__form').forEach(function (form) {
      var logic = form.getAttribute('data-logic');
      if (logic) {
        logic = JSON.parse(logic);
        var run = function () { apply(form, logic); };
        form.addEventListener('input', run);
        form.addEventListener('change', run);
        run();
      }
      var out = form.querySelector('[data-total]');
      if (out) {
        // After conditional logic (added first), so hidden products are already hidden.
        var sum = function () { out.textContent = money(total(form), out.getAttribute('data-currency') || 'USD'); };
        form.addEventListener('input', sum);
        form.addEventListener('change', sum);
        sum();
      }
      form.querySelectorAll('[data-mask="us-phone"]').forEach(function (i) {
        i.addEventListener('input', function () { formatPhone(i); });
      });
      form.querySelectorAll('[data-count]').forEach(function (i) {
        i.addEventListener('input', function () { counter(i); });
        counter(i);
      });
    });
    var focus = document.querySelector('.c-form [data-focus]');
    if (focus) {
      focus.focus({ preventScroll: true });
      focus.scrollIntoView({ block: 'center' });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
