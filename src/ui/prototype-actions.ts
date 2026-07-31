// @ts-nocheck — temporary prototype interaction port; cleaned up in 01-02
export function initPrototypeActions() {
let isStreamActive = true;
  let streamInterval = null;

  function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerHTML = `<span class="status-dot"></span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 2400);
  }

  function switchView(viewId, navElement) {
    document.querySelectorAll('.view-pane').forEach(pane => {
      pane.classList.remove('active');
      pane.setAttribute('aria-hidden', 'true');
    });

    const targetPane = document.getElementById('view-' + viewId);
    if (targetPane) {
      targetPane.classList.add('active');
      targetPane.setAttribute('aria-hidden', 'false');
    }

    if (navElement) {
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        item.setAttribute('aria-selected', 'false');
      });
      navElement.classList.add('active');
      navElement.setAttribute('aria-selected', 'true');
    }
  }

  function filterAgents() {
    const searchVal = (document.getElementById('agent-search-input')?.value || '').toLowerCase().trim();
    const statusVal = document.getElementById('agent-status-filter')?.value || 'all';
    const cliVal = document.getElementById('agent-cli-filter')?.value || 'all';

    const cards = document.querySelectorAll('.agent-card');
    let visibleCount = 0;

    cards.forEach(card => {
      const name = (card.getAttribute('data-agent-name') || '').toLowerCase();
      const status = card.getAttribute('data-status') || '';
      const cli = card.getAttribute('data-cli') || '';
      const content = card.textContent.toLowerCase();

      const matchesSearch = !searchVal || name.includes(searchVal) || content.includes(searchVal);
      const matchesStatus = statusVal === 'all' || status === statusVal;
      const matchesCli = cliVal === 'all' || cli === cliVal;

      if (matchesSearch && matchesStatus && matchesCli) {
        card.style.display = 'block';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    const emptyState = document.getElementById('agent-empty-state');
    if (emptyState) {
      emptyState.style.display = visibleCount === 0 ? 'flex' : 'none';
    }
  }

  function selectAgent(agentName) {
    document.getElementById('detail-agent-name').textContent = agentName;
    document.getElementById('detail-agent-repo').textContent = '绑定工作区: github.com/user/' + agentName + ' · 分支: main';
    switchView('agent-detail', document.querySelector('[data-od-id=nav-agent-detail]'));
    showToast('已载入 Agent [' + agentName + '] 的全量配置');
  }

  function setReasoning(pillElement) {
    const parent = pillElement.parentElement;
    parent.querySelectorAll('.reasoning-pill').forEach(p => p.classList.remove('active'));
    pillElement.classList.add('active');
    showToast('推理深度已更新为: ' + pillElement.textContent);
  }

  function openCmdKModal() {
    const modal = document.getElementById('cmdk-modal');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    const input = modal.querySelector('input');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  function closeCmdKModal() {
    const modal = document.getElementById('cmdk-modal');
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }

  function filterCmdK(inputEl) {
    const query = inputEl.value.toLowerCase().trim();
    const items = document.querySelectorAll('#cmdk-modal .nav-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = (!query || text.includes(query)) ? 'flex' : 'none';
    });
  }

  function openImportModal() {
    const modal = document.getElementById('import-modal');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeImportModal() {
    const modal = document.getElementById('import-modal');
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }

  function openSkillDetailModal(filename, desc) {
    document.getElementById('skill-modal-filename').textContent = filename;
    document.getElementById('skill-modal-desc').textContent = desc;
    document.getElementById('skill-modal').classList.add('active');
  }

  function closeSkillDetailModal() {
    document.getElementById('skill-modal').classList.remove('active');
  }

  function fillCommanderTemplate(type) {
    const textarea = document.getElementById('commander-prompt-text');
    if (type === 1) {
      textarea.value = "启动 Playwright 抓取竞品 A/B/C 网站的最新产品价格与促销活动，由 research-collector 提取 JSON 并汇总对比，生成 Markdown 竞品简报，并调用 workflow-orchestrator 自动发送到飞书工作群。";
    } else if (type === 2) {
      textarea.value = "使用 qa-regression-bot 启动无头浏览器，对主站与商城的 12 个核心页面执行 UI 巡检与断链检测，若发现加载时延超 2s 则触发告警。";
    } else if (type === 3) {
      textarea.value = "将本地 Markdown 周报自动转换为微信公众号与小红书美化排版，调用 web-browser-ops 登录后台发布草稿并记录排期。";
    }
    showToast('已载入模版，准备拆解');
  }

  function startOrchestration() {
    const btn = document.getElementById('start-orch-btn');
    btn.innerHTML = "正在分析意图与建图 (Orchestrating)...";
    btn.style.opacity = "0.7";

    setTimeout(() => {
      btn.innerHTML = "启动智能调度拆解 (Orchestrate)";
      btn.style.opacity = "1";
      showToast('调度拆解完成！包含 3 个子任务与路由矩阵');
    }, 450);
  }

  function dispatchCommanderTask() {
    showToast('任务已成功分发至对应 Repo 协同队列！');
    switchView('tasks', document.querySelector('[data-od-id=nav-tasks]'));
  }

  function runSandboxTest() {
    const term = document.getElementById('sandbox-term');
    const prompt = document.getElementById('sandbox-prompt').value;
    const time = new Date().toTimeString().split(' ')[0];

    const newLine = document.createElement('div');
    newLine.className = 'log-line';
    newLine.innerHTML = `<span class="log-time">${time}</span><span class="log-exec">[EXEC]</span> Running prompt: "${prompt}"...`;
    term.appendChild(newLine);

    setTimeout(() => {
      const resLine = document.createElement('div');
      resLine.className = 'log-line';
      resLine.innerHTML = `<span class="log-time">${time}</span><span class="log-ok">[OK]</span> Output generated via Cursor Agent CLI + Playwright engine. Test passed!`;
      term.appendChild(resLine);
      term.scrollTop = term.scrollHeight;
      showToast('沙盒测试命令运行完成');
    }, 600);
  }

  function clearLogs() {
    document.getElementById('live-terminal-body').innerHTML = '<div class="log-line"><span class="log-time">System</span> Logs cleared.</div>';
    showToast('终端日志已清空');
  }

  function copyTerminalLogs() {
    showToast('终端日志已复制到剪贴板！');
  }

  function toggleLiveLogStream() {
    const btn = document.getElementById('toggle-stream-btn');
    if (isStreamActive) {
      isStreamActive = false;
      btn.textContent = '▶ 恢复日志流';
      clearInterval(streamInterval);
      showToast('已暂停日志流');
    } else {
      isStreamActive = true;
      btn.textContent = '⏸ 暂停日志流';
      startLogSimulation();
      showToast('已恢复日志流');
    }
  }

  function filterTermTab(tabEl, filterType) {
    document.querySelectorAll('.term-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
    
    const lines = document.querySelectorAll('#live-terminal-body .log-line');
    lines.forEach(line => {
      if (filterType === 'all') {
        line.style.display = 'block';
      } else {
        const agent = line.getAttribute('data-agent');
        line.style.display = (agent === filterType) ? 'block' : 'none';
      }
    });
  }

  function filterTerminalByAgent(agentName) {
    showToast('已按 Agent [' + agentName + '] 过滤日志视角');
  }

  function switchTaskHistory(cardEl, taskId) {
    document.querySelectorAll('.task-item-card').forEach(c => c.classList.remove('active'));
    cardEl.classList.add('active');
    showToast('切换至任务视角: ' + taskId);
  }

  function startLogSimulation() {
    if (streamInterval) clearInterval(streamInterval);
    const mockLogs = [
      { time: '10:15:26', agent: '[research-collector]', tag: 'log-ok', label: '[SYNC]', text: 'Syncing markdown payload to feishu-webhook buffer...' },
      { time: '10:15:30', agent: '[workflow-orchestrator]', tag: 'log-exec', label: '[BOT]', text: 'Feishu Webhook triggered successfully. HTTP 200 OK.' },
      { time: '10:15:35', agent: '[web-browser-ops]', tag: 'log-ok', label: '[CLEANUP]', text: 'Playwright browser context closed cleanly.' }
    ];
    let idx = 0;
    streamInterval = setInterval(() => {
      if (!isStreamActive) return;
      if (idx >= mockLogs.length) {
        clearInterval(streamInterval);
        return;
      }
      const item = mockLogs[idx++];
      const body = document.getElementById('live-terminal-body');
      if (body) {
        const line = document.createElement('div');
        line.className = 'log-line';
        line.setAttribute('data-agent', 'collector');
        line.innerHTML = `<span class="log-time">${item.time}</span><span class="log-agent">${item.agent}</span><span class="${item.tag}">${item.label}</span> ${item.text}`;
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
      }
    }, 4500);
  }

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCmdKModal();
    }
    if (e.key === 'Escape') {
      closeCmdKModal();
      closeImportModal();
      closeSkillDetailModal();
    }
  });

  // Init
  startLogSimulation();

  // Expose for inline onclick handlers in migrated markup
  const api = {
    showToast,
    switchView,
    filterAgents,
    selectAgent,
    setReasoning,
    openCmdKModal,
    closeCmdKModal,
    filterCmdK,
    openImportModal,
    closeImportModal,
    openSkillDetailModal,
    closeSkillDetailModal,
    fillCommanderTemplate,
    startOrchestration,
    dispatchCommanderTask,
    runSandboxTest,
    clearLogs,
    copyTerminalLogs,
    toggleLiveLogStream,
    filterTermTab,
    filterTerminalByAgent,
    switchTaskHistory,
  };
  Object.assign(window, api);
}
