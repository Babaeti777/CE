import { StateManager } from './state/state-manager.js';
import { createStorageService } from './services/storage-service.js';
import { CommandHistory } from './services/command-history.js';

const MATERIAL_SOURCE = 'data/database.json';
const STORAGE_KEYS = {
  projects: 'projects:v1',
  company: 'company:v1',
  catalog: 'catalog:v1',
  catalogVersion: 'catalogVersion'
};

const QUICK_SCOPE = [
  {
    id: 'foundation',
    category: 'foundation',
    label: 'Foundation system',
    helper: 'Concrete, piers, or crawl space assemblies',
    quantity: ({ sqft }) => sqft,
  },
  {
    id: 'framing',
    category: 'framing',
    label: 'Structural framing',
    helper: 'Studs, joists, columns, and beams',
    quantity: ({ sqft, floors }) => sqft * floors,
  },
  {
    id: 'enclosure',
    category: 'exterior',
    label: 'Exterior enclosure',
    helper: 'Walls, cladding, and facade systems',
    quantity: ({ sqft, floors }) => Math.max(sqft * floors * 0.8, 0),
  },
];

const PROJECT_STATUSES = ['draft', 'review', 'won', 'lost'];
const STATUS_LABELS = {
  draft: 'Draft',
  review: 'In review',
  won: 'Won',
  lost: 'Lost'
};

const storage = createStorageService({ prefix: 'ce' });
const stateManager = new StateManager({
  currentTab: 'dashboard',
  materials: { version: null, categories: [] },
  savedProjects: [],
  company: { company: '', address: '', phone: '', email: '' },
  estimator: { result: null, values: null },
  filters: { draftsOnly: false },
});
const state = stateManager.state;
const history = new CommandHistory();

const dom = {};

async function init() {
  cacheDom();
  bindGlobalListeners();
  hydrateStateFromStorage();
  switchTab(state.currentTab);
  try {
    await ensureMaterialCatalog();
  } catch (error) {
    console.error(error);
    showToast('Unable to load material catalogue.', 'error');
  }
  renderMaterialSelectors();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);

function cacheDom() {
  dom.navButtons = Array.from(document.querySelectorAll('.tab-link'));
  dom.panels = Array.from(document.querySelectorAll('.panel'));
  dom.metrics = {
    total: document.getElementById('metricTotalProjects'),
    value: document.getElementById('metricTotalValue'),
    review: document.getElementById('metricReviewCount'),
    win: document.getElementById('metricWinRate'),
  };
  dom.recentProjects = document.getElementById('recentProjects');
  dom.companySnapshot = document.getElementById('companySnapshot');
  dom.estimateForm = document.getElementById('estimateForm');
  dom.materialSelectors = document.getElementById('materialSelectors');
  dom.estimateHint = document.getElementById('estimateHint');
  dom.estimateBreakdown = document.getElementById('estimateBreakdown');
  dom.estimateDetails = document.getElementById('estimateDetails');
  dom.estimateTotal = document.getElementById('estimateTotal');
  dom.saveEstimate = document.getElementById('saveEstimate');
  dom.projectsTable = document.getElementById('projectsTable');
  dom.settingsForm = document.getElementById('settingsForm');
  dom.materialsList = document.getElementById('materialsList');
  dom.toastRegion = document.querySelector('.toast-region');
  dom.undo = document.getElementById('undoAction');
  dom.redo = document.getElementById('redoAction');
  dom.newProject = document.getElementById('newProjectFromDashboard');
  dom.filterDrafts = document.getElementById('filterDrafts');
  dom.clearFilters = document.getElementById('clearFilters');
}

function bindGlobalListeners() {
  dom.navButtons.forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  dom.estimateForm.addEventListener('submit', handleEstimateSubmit);
  dom.estimateForm.addEventListener('input', debounce(handleEstimatorChange, 150));
  dom.saveEstimate.addEventListener('click', handleSaveEstimate);
  dom.projectsTable.addEventListener('change', handleProjectTableChange);
  dom.projectsTable.addEventListener('click', handleProjectTableClick);
  dom.settingsForm.addEventListener('submit', handleSettingsSubmit);
  dom.undo.addEventListener('click', () => {
    history.undo();
    renderAll();
    refreshHistoryButtons();
  });
  dom.redo.addEventListener('click', () => {
    history.redo();
    renderAll();
    refreshHistoryButtons();
  });
  dom.newProject.addEventListener('click', () => {
    switchTab('estimator');
    dom.estimateForm.projectName?.focus();
  });
  dom.filterDrafts.addEventListener('click', () => {
    const next = !state.filters.draftsOnly;
    stateManager.setState('filters.draftsOnly', next);
    dom.filterDrafts.textContent = next ? 'Showing drafts' : 'Show drafts';
    renderProjects();
  });
  dom.clearFilters.addEventListener('click', () => {
    if (!state.filters.draftsOnly) return;
    stateManager.setState('filters.draftsOnly', false);
    dom.filterDrafts.textContent = 'Show drafts';
    renderProjects();
  });
}

function hydrateStateFromStorage() {
  try {
    const projectsRaw = storage.getItem(STORAGE_KEYS.projects);
    if (projectsRaw) {
      const saved = JSON.parse(projectsRaw);
      stateManager.setState('savedProjects', Array.isArray(saved) ? saved : []);
    }
  } catch (error) {
    console.warn('Unable to restore projects', error);
  }

  try {
    const companyRaw = storage.getItem(STORAGE_KEYS.company);
    if (companyRaw) {
      const company = JSON.parse(companyRaw);
      stateManager.setState('company', { ...state.company, ...company });
    }
  } catch (error) {
    console.warn('Unable to restore company profile', error);
  }
}

async function ensureMaterialCatalog() {
  const cachedVersion = storage.getItem(STORAGE_KEYS.catalogVersion);
  const cachedCatalog = storage.getItem(STORAGE_KEYS.catalog);
  if (cachedVersion && cachedCatalog) {
    try {
      const parsed = JSON.parse(cachedCatalog);
      stateManager.setState('materials', parsed);
      return;
    } catch (error) {
      console.warn('Failed to parse cached catalog, downloading fresh copy.', error);
    }
  }

  const response = await fetch(MATERIAL_SOURCE, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to load material catalogue (${response.status})`);
  }
  const payload = await response.json();
  const catalogue = transformCatalogue(payload);
  stateManager.setState('materials', catalogue);
  storage.setItem(STORAGE_KEYS.catalog, JSON.stringify(catalogue));
  storage.setItem(STORAGE_KEYS.catalogVersion, payload.version || '1.0.0');
}

function transformCatalogue(payload) {
  const categories = Object.entries(payload.materialPrices || {}).map(([category, entries]) => {
    const options = Object.entries(entries).map(([id, value]) => ({
      id,
      label: value.label,
      cost: Number(value.cost || 0),
      unit: value.unit || 'unit',
      notes: value.notes || null,
      lastUpdated: value.lastUpdated || null,
    }));
    return { id: category, label: titleCase(category), options };
  });
  return { version: payload.version || null, categories };
}

function renderAll() {
  refreshHistoryButtons();
  renderDashboard();
  renderCompanySnapshot();
  renderEstimateResult(state.estimator.result);
  populateSettingsForm();
  renderProjects();
  renderMaterialsList();
}

function switchTab(tab) {
  stateManager.setState('currentTab', tab);
  dom.navButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });
  dom.panels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === tab);
  });
}

function renderDashboard() {
  const projects = state.savedProjects || [];
  const total = projects.length;
  const totalValue = projects.reduce((acc, item) => acc + (item.estimate?.totals?.total || 0), 0);
  const reviewCount = projects.filter((item) => item.status === 'review').length;
  const outcomeProjects = projects.filter((item) => ['won', 'lost'].includes(item.status));
  const wins = outcomeProjects.filter((item) => item.status === 'won').length;
  const winRate = outcomeProjects.length ? Math.round((wins / outcomeProjects.length) * 100) : 0;

  dom.metrics.total.textContent = total;
  dom.metrics.value.textContent = formatCurrency(totalValue);
  dom.metrics.review.textContent = reviewCount;
  dom.metrics.win.textContent = `${winRate}%`;

  const recent = projects.slice(0, 4);
  dom.recentProjects.innerHTML = '';
  if (!recent.length) {
    dom.recentProjects.innerHTML = '<p class="muted">Projects you save will appear here.</p>';
  } else {
    recent.forEach((project) => {
      const container = document.createElement('div');
      container.className = 'timeline__item';
      container.innerHTML = `
        <div>
          <strong>${escapeHtml(project.name)}</strong>
          <div class="timeline__meta">${formatDate(project.updatedAt)} • ${titleCase(project.type)}</div>
        </div>
        <span class="badge" data-status="${project.status}">${STATUS_LABELS[project.status] || project.status}</span>
      `;
      dom.recentProjects.appendChild(container);
    });
  }
}

function renderCompanySnapshot() {
  const company = state.company;
  const entries = [
    ['Company', company.company || '—'],
    ['Address', company.address || '—'],
    ['Phone', company.phone || '—'],
    ['Email', company.email || '—'],
  ];
  dom.companySnapshot.innerHTML = entries.map(([term, detail]) => `
    <div>
      <dt>${term}</dt>
      <dd>${escapeHtml(detail)}</dd>
    </div>
  `).join('');
}

function renderMaterialSelectors() {
  dom.materialSelectors.querySelectorAll('[data-material-selector]').forEach((node) => node.remove());
  QUICK_SCOPE.forEach((scope) => {
    const category = state.materials.categories.find((item) => item.id === scope.category);
    if (!category) return;
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    wrapper.dataset.materialSelector = scope.id;
    const select = document.createElement('select');
    select.name = `material-${scope.category}`;
    select.required = true;
    select.innerHTML = ['<option value="">Select material</option>',
      ...category.options.map((option) => `
        <option value="${option.id}">${escapeHtml(option.label)} • ${formatCurrency(option.cost)} / ${option.unit}</option>
      `),
    ].join('');
    const currentSelection = state.estimator.values?.materials?.[scope.category];
    if (currentSelection) {
      select.value = currentSelection;
    }
    select.addEventListener('change', () => {
      stateManager.setState(`estimator.values.materials.${scope.category}`, select.value);
      updateEstimatePreview();
    });

    wrapper.innerHTML = `
      <span class="field__label">${scope.label}</span>
    `;
    wrapper.appendChild(select);
    if (scope.helper) {
      const helper = document.createElement('p');
      helper.className = 'muted';
      helper.textContent = scope.helper;
      wrapper.appendChild(helper);
    }
    dom.materialSelectors.appendChild(wrapper);
  });
}

function handleEstimatorChange() {
  updateEstimatePreview();
}

function handleEstimateSubmit(event) {
  event.preventDefault();
  const result = updateEstimatePreview({ announce: true });
  if (!result) {
    showToast('Add the required details before generating an estimate.', 'error');
  }
}

function updateEstimatePreview({ announce = false } = {}) {
  const values = readEstimatorValues();
  if (!values) {
    dom.estimateBreakdown.hidden = true;
    dom.estimateHint.hidden = false;
    dom.saveEstimate.disabled = true;
    stateManager.setState('estimator.result', null);
    return null;
  }
  const result = calculateEstimate(values);
  stateManager.setState('estimator.result', result);
  stateManager.setState('estimator.values', values);
  renderEstimateResult(result);
  if (announce) {
    showToast('Estimate generated', 'success');
  }
  return result;
}

function readEstimatorValues() {
  const form = new FormData(dom.estimateForm);
  const projectName = form.get('projectName');
  const projectType = form.get('projectType');
  const sqft = Number(form.get('sqft'));
  const floors = Number(form.get('floors'));
  const laborMultiplier = Number(form.get('laborMultiplier'));
  if (!projectName || !projectType || !Number.isFinite(sqft) || !Number.isFinite(floors) || !Number.isFinite(laborMultiplier)) {
    return null;
  }
  const materials = {};
  for (const scope of QUICK_SCOPE) {
    const selected = form.get(`material-${scope.category}`);
    if (!selected) {
      return null;
    }
    materials[scope.category] = selected;
  }
  return { projectName, projectType, sqft, floors, laborMultiplier, materials };
}

function calculateEstimate(values) {
  const { sqft, floors, laborMultiplier, materials } = values;
  const lineItems = [];
  let materialsTotal = 0;

  QUICK_SCOPE.forEach((scope) => {
    const category = state.materials.categories.find((item) => item.id === scope.category);
    if (!category) return;
    const material = category.options.find((option) => option.id === materials[scope.category]);
    if (!material) return;
    const quantity = scope.quantity({ sqft, floors });
    const total = quantity * material.cost;
    materialsTotal += total;
    lineItems.push({
      id: scope.id,
      label: material.label,
      quantity,
      unit: material.unit,
      unitCost: material.cost,
      total,
    });
  });

  const laborMultiplierSafe = Math.max(laborMultiplier, 1);
  const laborTotal = materialsTotal * (laborMultiplierSafe - 1);
  const contingency = (materialsTotal + laborTotal) * 0.1;
  const grandTotal = materialsTotal + laborTotal + contingency;

  return {
    lineItems,
    totals: {
      materials: materialsTotal,
      labor: laborTotal,
      contingency,
      total: grandTotal,
    },
    generatedAt: new Date().toISOString(),
    inputs: values,
  };
}

function renderEstimateResult(result) {
  if (!result) {
    dom.estimateBreakdown.hidden = true;
    dom.estimateHint.hidden = false;
    dom.saveEstimate.disabled = true;
    return;
  }

  dom.estimateDetails.innerHTML = '';
  result.lineItems.forEach((item) => {
    const dt = document.createElement('dt');
    dt.textContent = item.label;
    const dd = document.createElement('dd');
    dd.innerHTML = `${formatCurrency(item.total)} · ${formatQuantity(item.quantity)} ${item.unit} @ ${formatCurrency(item.unitCost)}`;
    dom.estimateDetails.append(dt, dd);
  });

  const summaryEntries = [
    ['Labor', result.totals.labor],
    ['Contingency', result.totals.contingency],
  ];
  summaryEntries.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = formatCurrency(value);
    dom.estimateDetails.append(dt, dd);
  });

  dom.estimateTotal.textContent = formatCurrency(result.totals.total);
  dom.estimateBreakdown.hidden = false;
  dom.estimateHint.hidden = true;
  dom.saveEstimate.disabled = false;
}

function handleSaveEstimate() {
  const result = state.estimator.result;
  const values = state.estimator.values;
  if (!result || !values) return;

    const project = {
      id: createProjectId(),
    name: values.projectName,
    type: values.projectType,
    sqft: values.sqft,
    floors: values.floors,
    laborMultiplier: values.laborMultiplier,
    materials: values.materials,
    estimate: result,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  history.execute({
    execute: () => {
      setProjects([project, ...state.savedProjects]);
      showToast('Project saved to your list.', 'success');
    },
    undo: () => {
      removeProject(project.id);
      showToast('Project removed.', 'success');
    },
    redo: () => {
      setProjects([project, ...state.savedProjects]);
      showToast('Project restored.', 'success');
    }
  });
  refreshHistoryButtons();
  switchTab('projects');
}

function setProjects(next) {
  stateManager.setState('savedProjects', next);
  storage.setItem(STORAGE_KEYS.projects, JSON.stringify(next));
  renderProjects();
  renderDashboard();
}

function removeProject(id) {
  const remaining = state.savedProjects.filter((project) => project.id !== id);
  setProjects(remaining);
}

function renderProjects() {
  const projects = state.savedProjects || [];
  const filtered = state.filters.draftsOnly ? projects.filter((item) => item.status === 'draft') : projects;
  dom.projectsTable.innerHTML = '';
  if (!filtered.length) {
    dom.projectsTable.innerHTML = '<tr><td colspan="6" class="muted">No projects available yet.</td></tr>';
    return;
  }

  filtered.forEach((project) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div><strong>${escapeHtml(project.name)}</strong></div>
        <div class="muted">${formatQuantity(project.sqft)} sqft · ${project.floors} floors</div>
      </td>
      <td>${titleCase(project.type)}</td>
      <td>
        <span class="badge" data-status="${project.status}">${STATUS_LABELS[project.status] || project.status}</span>
        <div>
          <label class="sr-only" for="status-${project.id}">Update status</label>
          <select id="status-${project.id}" data-action="status" data-id="${project.id}">
            ${PROJECT_STATUSES.map((status) => `<option value="${status}" ${status === project.status ? 'selected' : ''}>${STATUS_LABELS[status]}</option>`).join('')}
          </select>
        </div>
      </td>
      <td>${formatCurrency(project.estimate?.totals?.total || 0)}</td>
      <td>${formatDate(project.updatedAt)}</td>
      <td class="text-right">
        <button class="ghost" type="button" data-action="duplicate" data-id="${project.id}">Duplicate</button>
        <button class="ghost" type="button" data-action="delete" data-id="${project.id}">Delete</button>
      </td>
    `;
    dom.projectsTable.appendChild(row);
  });
}

function handleProjectTableChange(event) {
  const target = event.target;
  if (target?.dataset.action !== 'status') return;
  const projectId = target.dataset.id;
  const nextStatus = target.value;
  const project = state.savedProjects.find((item) => item.id === projectId);
  if (!project || !PROJECT_STATUSES.includes(nextStatus)) return;
  const previousStatus = project.status;

  if (previousStatus === nextStatus) return;

  history.execute({
    execute: () => {
      updateProject(projectId, { status: nextStatus, updatedAt: new Date().toISOString() });
      showToast('Status updated', 'success');
    },
    undo: () => {
      updateProject(projectId, { status: previousStatus, updatedAt: new Date().toISOString() });
      showToast('Reverted status change', 'success');
    }
  });
  refreshHistoryButtons();
}

function handleProjectTableClick(event) {
  const target = event.target.closest('button[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  const project = state.savedProjects.find((item) => item.id === id);
  if (!project) return;

  if (action === 'delete') {
    history.execute({
      execute: () => {
        removeProject(id);
        showToast('Project deleted.', 'success');
      },
      undo: () => {
        setProjects([project, ...state.savedProjects]);
        showToast('Project restored.', 'success');
      }
    });
    refreshHistoryButtons();
  }

  if (action === 'duplicate') {
      const duplicated = {
        ...clone(project),
        id: createProjectId(),
      name: `${project.name} (copy)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    history.execute({
      execute: () => {
        setProjects([duplicated, ...state.savedProjects]);
        showToast('Project duplicated.', 'success');
      },
      undo: () => {
        removeProject(duplicated.id);
        showToast('Duplicate removed.', 'success');
      }
    });
    refreshHistoryButtons();
  }
}

function updateProject(id, patch) {
  const next = state.savedProjects.map((item) => (item.id === id ? { ...item, ...patch } : item));
  setProjects(next);
}

function renderMaterialsList() {
  const catalog = state.materials.categories;
  dom.materialsList.innerHTML = '';
  if (!catalog.length) {
    dom.materialsList.innerHTML = '<p class="muted">Material catalogue unavailable.</p>';
    return;
  }

  catalog.forEach((category) => {
    const section = document.createElement('section');
    section.className = 'material-card';
    section.innerHTML = `
      <h3 class="material-card__title">${titleCase(category.label)}</h3>
      <div class="material-card__meta">${category.options.length} items</div>
      <ul class="stack">
        ${category.options.slice(0, 3).map((option) => `
          <li>
            <strong>${escapeHtml(option.label)}</strong>
            <div class="muted">${formatCurrency(option.cost)} per ${option.unit}</div>
          </li>
        `).join('')}
      </ul>
    `;
    dom.materialsList.appendChild(section);
  });
}

function populateSettingsForm() {
  const company = state.company;
  dom.settingsForm.company.value = company.company || '';
  dom.settingsForm.address.value = company.address || '';
  dom.settingsForm.phone.value = company.phone || '';
  dom.settingsForm.email.value = company.email || '';
}

function handleSettingsSubmit(event) {
  event.preventDefault();
  const form = new FormData(dom.settingsForm);
  const payload = {
    company: form.get('company') || '',
    address: form.get('address') || '',
    phone: form.get('phone') || '',
    email: form.get('email') || '',
  };
  stateManager.setState('company', payload);
  storage.setItem(STORAGE_KEYS.company, JSON.stringify(payload));
  renderCompanySnapshot();
  showToast('Profile saved', 'success');
}

function refreshHistoryButtons() {
  dom.undo.disabled = history.currentIndex < 0;
  dom.redo.disabled = history.currentIndex >= history.history.length - 1;
}

function showToast(message, variant = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${variant}`;
  toast.textContent = message;
  dom.toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2500);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function formatQuantity(value) {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function titleCase(value = '') {
  return value
    .toString()
    .replace(/[_-]+/g, ' ')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function escapeHtml(value = '') {
  return value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function debounce(fn, wait = 200) {
  let timeout;
  return function debounced(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createProjectId() {
  const cryptoApi = globalThis?.crypto;
  if (cryptoApi?.randomUUID) {
    return `prj-${cryptoApi.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 8);
  return `prj-${Date.now().toString(36)}-${random}`;
}
