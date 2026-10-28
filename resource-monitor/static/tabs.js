import { ClientsView } from './clients.js';
import { recordScreen } from './visit-tracker.js';

const tabs = [...document.querySelectorAll('[data-metrics-tab]')];
const clients = new ClientsView(document.querySelector('#clients-panel'));

function select(name, updateHash = true) {
  const selected = name === 'clients' ? 'clients' : 'resources';
  for (const tab of tabs) {
    const active = tab.dataset.metricsTab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !active;
  }
  if (selected === 'clients') clients.activate(); else clients.deactivate();
  if (updateHash) history.replaceState(null, '', `#${selected}`);
  recordScreen(window.location.pathname, selected);
  window.dispatchEvent(new CustomEvent('metrics-tab-change', { detail: selected }));
  window.dispatchEvent(new Event('resize'));
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => select(tab.dataset.metricsTab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    tabs[next].focus();
    select(tabs[next].dataset.metricsTab);
  });
}
window.addEventListener('hashchange', () => select(location.hash.slice(1), false));
select(location.hash.slice(1));
