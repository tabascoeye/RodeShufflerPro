(function bootstrapBrowserApp() {
  const { bytesToHex, md5Bytes } = window.RodeShufflerUtils || {};
  const { buildLayout, exportRemappedBinary, formatPadFields, parseShowConfig } =
    window.RodeShufflerParser || {};

  if (!bytesToHex || !md5Bytes || !buildLayout || !exportRemappedBinary || !formatPadFields || !parseShowConfig) {
    throw new Error("Rode Shuffler dependencies did not load correctly.");
  }

  const state = {
    changeSummary: "Current remap status will appear here after a file is loaded.",
    currentFileBaseName: "show-config",
    draggedPadId: null,
    exportedBin: null,
    exportedMd5: null,
    layout: null,
    md5Digest: null,
    md5Status: "Not checked",
    modelOverride: "auto",
    parsed: null,
    selectedPadId: null,
    slotPadIds: null
  };

  const elements = {
    binInput: document.querySelector("#bin-input"),
    downloadBin: document.querySelector("#download-bin"),
    downloadMd5: document.querySelector("#download-md5"),
    changeSummary: document.querySelector("#change-summary"),
    inspector: document.querySelector("#inspector"),
    layoutGrid: document.querySelector("#layout-grid"),
    layoutSummary: document.querySelector("#layout-summary"),
    md5Input: document.querySelector("#md5-input"),
    md5Summary: document.querySelector("#md5-summary"),
    modelOverride: document.querySelector("#model-override"),
    modelSummary: document.querySelector("#model-summary"),
    notesList: document.querySelector("#notes-list"),
    padsSummary: document.querySelector("#pads-summary"),
    parserSummary: document.querySelector("#parser-summary"),
    resetLayout: document.querySelector("#reset-layout"),
    uploadNote: document.querySelector("#upload-note")
  };

  function createDownload(name, bytes) {
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function makeKeyValue(label, value) {
    const row = document.createElement("div");
    row.className = "inspector-row";
    row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    return row;
  }

  function updateMetrics() {
    elements.changeSummary.textContent = state.changeSummary;

    if (!state.parsed || !state.layout) {
      elements.modelSummary.textContent = "Waiting for file";
      elements.parserSummary.textContent = "Idle";
      elements.padsSummary.textContent = "No pads";
      elements.md5Summary.textContent = state.md5Status;
      return;
    }

    elements.modelSummary.textContent = state.layout.model.label;
    elements.parserSummary.textContent = `${state.parsed.structure.rootCount} roots / ${state.parsed.pads.length} PADs`;
    elements.padsSummary.textContent = `${state.layout.usedSlots}/${state.layout.model.totalSlots} slots used`;
    elements.md5Summary.textContent = state.md5Status;
  }

  function renderFindings() {
    elements.notesList.innerHTML = "";

    if (!state.parsed) {
      const item = document.createElement("li");
      item.textContent = "Upload a show-config.bin to walk the full show tree and inspect the smart pads.";
      elements.notesList.append(item);
      return;
    }

    state.parsed.findings.forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      elements.notesList.append(item);
    });

    if (state.layout?.overflowPads.length) {
      const item = document.createElement("li");
      item.textContent = `${state.layout.overflowPads.length} pads could not be placed into the visible slot range for the chosen model.`;
      elements.notesList.append(item);
    }
  }

  function renderInspector() {
    elements.inspector.innerHTML = "";

    if (!state.parsed || state.selectedPadId === null) {
      elements.inspector.innerHTML = `<p class="subtle">Select a pad to inspect its parsed fields.</p>`;
      return;
    }

    const pad = state.parsed.pads.find((entry) => entry.id === state.selectedPadId);
    if (!pad) {
      elements.inspector.innerHTML = `<p class="subtle">The selected pad is no longer available.</p>`;
      return;
    }

    const currentSlot = state.layout?.slotPadIds.indexOf(pad.id) ?? -1;
    const currentBank =
      currentSlot >= 0 && state.layout
        ? `Bank ${Math.floor(currentSlot / state.layout.model.padsPerBank) + 1}, Slot ${(currentSlot % state.layout.model.padsPerBank) + 1}`
        : "Not placed";

    const important = document.createElement("div");
    important.className = "inspector-grid";
    important.append(
      makeKeyValue("Name", pad.name),
      makeKeyValue("Type", `${pad.typeLabel} (padType ${pad.rawType})`),
      makeKeyValue("Current Slot", currentBank),
      makeKeyValue("Original Slot", `${pad.absoluteIndex}`),
      makeKeyValue("Colour", `${pad.colour.label} (index ${pad.colourIndex})`)
    );

    if (pad.filePath) {
      important.append(makeKeyValue("File", pad.filePath));
    }

    if (pad.playMode !== null) {
      important.append(makeKeyValue("Play Mode", `${pad.playMode}`));
    }

    if (pad.effectInput !== null) {
      important.append(makeKeyValue("Effect Input", `${pad.effectInput}`));
    }

    if (pad.mixerMode !== null) {
      important.append(makeKeyValue("Mixer Mode", `${pad.mixerMode}`));
    }

    if (pad.rcvSyncPadType !== null) {
      important.append(makeKeyValue("Action Subtype", `${pad.rcvSyncPadType}`));
    }

    elements.inspector.append(important);

    const rawTitle = document.createElement("h3");
    rawTitle.textContent = "Decoded Fields";
    rawTitle.className = "inspector-heading";
    elements.inspector.append(rawTitle);

    formatPadFields(pad).forEach((field) => {
      const row = document.createElement("div");
      row.className = "field-row";
      row.innerHTML = `<span>${field.label}</span><strong>${field.value}</strong>`;
      elements.inspector.append(row);
    });
  }

  function refreshExportArtifacts() {
    state.exportedBin = null;
    state.exportedMd5 = null;
    elements.downloadBin.disabled = true;
    elements.downloadMd5.disabled = true;
    state.changeSummary = "Current remap status will appear here after a file is loaded.";

    if (!state.parsed || !state.slotPadIds) {
      updateMetrics();
      return;
    }

    const exported = exportRemappedBinary(state.parsed, state.slotPadIds);
    state.exportedBin = exported.bytes.slice();
    state.exportedMd5 = md5Bytes(exported.bytes);
    let diffCount = 0;
    for (let index = 0; index < state.parsed.bytes.length; index += 1) {
      if (state.parsed.bytes[index] !== exported.bytes[index]) {
        diffCount += 1;
      }
    }

    const originalMd5 = bytesToHex(md5Bytes(state.parsed.bytes));
    const remappedMd5 = bytesToHex(state.exportedMd5);
    state.changeSummary =
      diffCount === 0
        ? `Current remap is unchanged. Export MD5: ${remappedMd5}.`
        : `Current remap changes ${diffCount} byte${diffCount === 1 ? "" : "s"}. Original MD5: ${originalMd5}. Remapped MD5: ${remappedMd5}.`;
    elements.downloadBin.disabled = false;
    elements.downloadMd5.disabled = false;
    updateMetrics();
  }

  function rebuildLayout(resetSlots = false) {
    if (!state.parsed) {
      state.layout = null;
      state.slotPadIds = null;
      updateMetrics();
      renderFindings();
      renderInspector();
      return;
    }

    const layout = buildLayout(state.parsed, {
      modelOverride: state.modelOverride,
      slotPadIds: resetSlots ? null : state.slotPadIds
    });

    state.layout = layout;
    state.slotPadIds = layout.slotPadIds.slice();
    if (state.selectedPadId === null && state.parsed.pads.length) {
      state.selectedPadId = state.parsed.pads[0].id;
    }

    elements.resetLayout.disabled = false;
    refreshExportArtifacts();
    updateMetrics();
    renderLayout();
    renderFindings();
    renderInspector();
  }

  function movePad(draggedPadId, targetAbsoluteIndex) {
    if (!state.slotPadIds) {
      return;
    }

    const next = state.slotPadIds.slice();
    const originIndex = next.indexOf(draggedPadId);
    if (originIndex === -1) {
      return;
    }

    const targetPadId = next[targetAbsoluteIndex];
    next[targetAbsoluteIndex] = draggedPadId;
    next[originIndex] = targetPadId === undefined ? null : targetPadId;
    state.slotPadIds = next;
    rebuildLayout(false);
  }

  function slotsForDisplay(bankSlots) {
    const rows = Math.ceil(bankSlots.length / 2);
    const ordered = [];

    for (let row = 0; row < rows; row += 1) {
      if (bankSlots[row]) {
        ordered.push(bankSlots[row]);
      }
      if (bankSlots[row + rows]) {
        ordered.push(bankSlots[row + rows]);
      }
    }

    return ordered;
  }

  function renderLayout() {
    elements.layoutGrid.innerHTML = "";

    if (!state.layout) {
      elements.layoutGrid.className = "bank-grid empty-state";
      elements.layoutGrid.innerHTML = `
        <div class="empty-card">
          <h3>No show loaded</h3>
          <p>Upload a <code>show-config.bin</code> to parse the full show tree and map its smart pads.</p>
        </div>
      `;
      elements.layoutSummary.textContent =
        "The pad banks will appear here after the file is parsed.";
      return;
    }

    elements.layoutGrid.className = "bank-grid";
    const geometry = state.layout.model.key === "duo" ? "2x3" : "2x4";
    elements.layoutSummary.textContent = `${geometry} bank layout, absolute placement taken from padIdx, drag/drop swaps pad positions.`;

    state.layout.banks.forEach((bank) => {
      const bankCard = document.createElement("section");
      bankCard.className = "bank-card";

      const head = document.createElement("div");
      head.className = "bank-head";
      head.innerHTML = `
        <strong>Bank ${bank.bankIndex + 1}</strong>
        <span>${bank.filledSlots}/${state.layout.model.padsPerBank} used</span>
      `;
      bankCard.append(head);

      const slots = document.createElement("div");
      slots.className = `slots ${state.layout.model.key === "duo" ? "duo" : "pro"}`;

      slotsForDisplay(bank.slots).forEach((slot) => {
        const slotElement = document.createElement("div");
        slotElement.className = `slot${slot.padId === null ? " empty" : ""}`;
        slotElement.dataset.slotLabel = `#${slot.absoluteIndex}`;
        slotElement.addEventListener("dragover", (event) => {
          event.preventDefault();
          slotElement.classList.add("drag-over");
        });
        slotElement.addEventListener("dragleave", () => {
          slotElement.classList.remove("drag-over");
        });
        slotElement.addEventListener("drop", (event) => {
          event.preventDefault();
          slotElement.classList.remove("drag-over");

          if (state.draggedPadId === null) {
            return;
          }

          movePad(state.draggedPadId, slot.absoluteIndex);
          state.draggedPadId = null;
        });

        if (slot.padId === null) {
          slotElement.innerHTML = `<span class="slot-empty">Empty</span>`;
        } else {
          const pad = state.layout.padById.get(slot.padId);
          const card = document.createElement("article");
          card.className = `pad-card${state.selectedPadId === pad.id ? " selected" : ""}`;
          card.draggable = true;
          card.style.setProperty("--pad-colour", pad.colour.swatch);
          card.addEventListener("dragstart", () => {
            state.draggedPadId = pad.id;
          });
          card.addEventListener("click", () => {
            state.selectedPadId = pad.id;
            renderLayout();
            renderInspector();
          });
          card.innerHTML = `<div class="pad-name">${pad.name}</div>`;
          slotElement.append(card);
        }

        slots.append(slotElement);
      });

      bankCard.append(slots);
      elements.layoutGrid.append(bankCard);
    });
  }

  async function verifyMd5File(file) {
    if (!state.md5Digest) {
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder().decode(bytes).trim().toLowerCase();
    const digestHex = bytesToHex(state.md5Digest);

    const matches =
      (bytes.length === 16 && bytes.every((byte, index) => byte === state.md5Digest[index])) ||
      text === digestHex;

    state.md5Status = matches ? "Checksum matches" : "Checksum mismatch";
    updateMetrics();
  }

  elements.binInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      state.currentFileBaseName = file.name.replace(/\.[^.]+$/, "") || "show-config";
      state.modelOverride = "auto";
      elements.modelOverride.value = "auto";
      state.parsed = parseShowConfig(bytes);
      state.slotPadIds = null;
      state.selectedPadId = null;
      state.md5Digest = md5Bytes(bytes);
      state.md5Status = "Computed locally";
      elements.uploadNote.textContent = `Loaded ${file.name} (${bytes.length.toLocaleString()} bytes). Tree root selected at byte ${state.parsed.firstNodeOffset.toLocaleString()}, SOUNDPADS at byte ${state.parsed.soundPadsNode.start.toLocaleString()}, ${state.parsed.structure.rootCount} root nodes walked.`;
      rebuildLayout(true);

      const md5File = elements.md5Input.files?.[0];
      if (md5File) {
        await verifyMd5File(md5File);
      }
    } catch (error) {
      state.parsed = null;
      state.slotPadIds = null;
      state.layout = null;
      state.selectedPadId = null;
      state.md5Status = "Parse failed";
      elements.uploadNote.textContent = error instanceof Error ? error.message : String(error);
      updateMetrics();
      renderLayout();
      renderFindings();
      renderInspector();
    }
  });

  elements.md5Input.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await verifyMd5File(file);
  });

  elements.modelOverride.addEventListener("change", (event) => {
    state.modelOverride = event.target.value;
    rebuildLayout(false);
  });

  elements.resetLayout.addEventListener("click", () => {
    rebuildLayout(true);
  });

  elements.downloadBin.addEventListener("click", () => {
    if (!state.exportedBin) {
      return;
    }

    createDownload(`${state.currentFileBaseName}.bin`, state.exportedBin);
  });

  elements.downloadMd5.addEventListener("click", () => {
    if (!state.exportedMd5) {
      return;
    }

    createDownload(`${state.currentFileBaseName}.md5`, state.exportedMd5);
  });

  updateMetrics();
  renderLayout();
  renderFindings();
  renderInspector();
})();
