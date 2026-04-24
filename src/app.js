(function bootstrapBrowserApp() {
  const { bytesToHex, md5Bytes } = window.RodeShufflerUtils || {};
  const { buildLayout, cleanOrphanPadEffects, exportRemappedBinary, formatPadFields, parseShowConfig, padTypeIcon } =
    window.RodeShufflerParser || {};

  if (!bytesToHex || !md5Bytes || !buildLayout || !cleanOrphanPadEffects || !exportRemappedBinary || !formatPadFields || !parseShowConfig) {
    throw new Error("Rode Shuffler dependencies did not load correctly.");
  }

  const state = {
    changeSummary: "Current remap status will appear here after a file is loaded.",
    currentFileBaseName: "show-config",
    draggedPadId: null,
    exportedBin: null,
    exportedMd5: null,
    isDuplicating: false,
    altKeyPressed: false,
    layout: null,
    md5Digest: null,
    md5Status: "Not checked",
    modelOverride: "auto",
    originalParsed: null,
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

    const important = document.createElement("div");
    important.className = "inspector-grid";

    // Editable name field
    const nameRow = document.createElement("div");
    nameRow.className = "inspector-row";
    const nameLabel = document.createElement("span");
    nameLabel.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = pad.name;
    nameInput.addEventListener("input", (event) => {
      pad.name = event.target.value;
      renderLayout(); // Update the pad display
    });
    nameInput.addEventListener("blur", () => {
      // Could add save logic here if needed
    });
    nameRow.append(nameLabel, nameInput);

    // Type field (read-only)
    const typeRow = document.createElement("div");
    typeRow.className = "inspector-row";
    const typeLabel = document.createElement("span");
    typeLabel.textContent = "Type";
    const typeValue = document.createElement("strong");
    typeValue.textContent = `${pad.typeLabel} (padType ${pad.rawType})`;
    typeRow.append(typeLabel, typeValue);

    // File path field (read-only, if exists)
    const fileRow = document.createElement("div");
    fileRow.className = "inspector-row";
    const fileLabel = document.createElement("span");
    fileLabel.textContent = "File";
    const fileValue = document.createElement("strong");
    fileValue.textContent = pad.filePath || "No file";
    fileRow.append(fileLabel, fileValue);

    important.append(nameRow, typeRow, fileRow);
    elements.inspector.append(important);
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

    const originalBytes = state.originalParsed ? state.originalParsed.bytes : state.parsed.bytes;
    const maxLen = Math.max(originalBytes.length, exported.bytes.length);
    let diffCount = 0;
    for (let index = 0; index < maxLen; index += 1) {
      if (originalBytes[index] !== exported.bytes[index]) {
        diffCount += 1;
      }
    }

    const originalMd5 = bytesToHex(md5Bytes(originalBytes));
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
      renderInspector();
      return;
    }

    const layout = buildLayout(state.parsed, {
      modelOverride: state.modelOverride,
      slotPadIds: resetSlots ? null : state.slotPadIds
    });

    state.layout = layout;
    state.slotPadIds = layout.slotPadIds.slice();

    elements.resetLayout.disabled = false;
    refreshExportArtifacts();
    updateMetrics();
    renderLayout();
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

  function duplicatePad(draggedPadId, targetAbsoluteIndex) {
    if (!state.parsed || !state.layout) {
      console.error('No file loaded');
      return;
    }

    if (!window.RodeShufflerParser || !window.RodeShufflerParser.duplicatePadBinary) {
      console.error('Binary duplication not available');
      return;
    }

    const sourcePad = state.layout.padById.get(draggedPadId);
    if (!sourcePad) {
      console.error('Source pad not found');
      return;
    }

    // Check actual current slot position from slotPadIds, not absoluteIndex
    const currentSlotIndex = state.slotPadIds.indexOf(draggedPadId);
    if (currentSlotIndex === targetAbsoluteIndex) {
      return;
    }

    const targetPadId = state.slotPadIds[targetAbsoluteIndex];
    const overwriteTarget = targetPadId !== null && targetPadId !== undefined && targetPadId !== draggedPadId;

    try {
      const result = window.RodeShufflerParser.duplicatePadBinary(
        state.parsed,
        draggedPadId,
        targetAbsoluteIndex,
        overwriteTarget ? targetPadId : null
      );

      state.parsed = result.parsed;

      const totalSlots = state.layout.model.totalSlots;
      const nextSlotPadIds = state.slotPadIds.slice(0, totalSlots);

      // If overwriting, remove the old target pad id from wherever it was
      if (overwriteTarget) {
        for (let i = 0; i < totalSlots; i += 1) {
          if (nextSlotPadIds[i] === targetPadId) {
            nextSlotPadIds[i] = null;
          }
        }
      }

      nextSlotPadIds[targetAbsoluteIndex] = result.newPadId;
      state.slotPadIds = nextSlotPadIds;
      state.selectedPadId = result.newPadId;

      rebuildLayout(false);
    } catch (error) {
      console.error('Duplication failed:', error);
    }
  }

  function findNextPadInVisualOrder(startAbsoluteIndex) {
    const model = state.layout.model;
    const padsPerBank = model.padsPerBank;
    const rows = Math.ceil(padsPerBank / 2);
    const totalSlots = model.totalSlots;

    // Build visual order offsets within a bank (same as slotsForDisplay)
    const bankVisualOrder = [];
    for (let row = 0; row < rows; row += 1) {
      bankVisualOrder.push(row);
      bankVisualOrder.push(row + rows);
    }

    const startBank = Math.floor(startAbsoluteIndex / padsPerBank);
    const startOffset = startAbsoluteIndex % padsPerBank;
    const startVisualIndex = bankVisualOrder.indexOf(startOffset);

    let currentBank = startBank;
    let currentVisualIndex = startVisualIndex;

    while (true) {
      currentVisualIndex += 1;
      if (currentVisualIndex >= bankVisualOrder.length) {
        currentVisualIndex = 0;
        currentBank += 1;
        if (currentBank * padsPerBank >= totalSlots) {
          currentBank = 0;
        }
      }

      // Stop if we've wrapped all the way around
      if (currentBank === startBank && currentVisualIndex === startVisualIndex) {
        break;
      }

      const absIndex = currentBank * padsPerBank + bankVisualOrder[currentVisualIndex];
      if (absIndex >= totalSlots) {
        continue;
      }

      const padId = state.slotPadIds[absIndex];
      if (padId !== null && padId !== undefined) {
        return padId;
      }
    }

    return null;
  }

  function deletePad(padId) {
    if (!state.parsed || !state.layout) {
      console.error('No file loaded');
      return;
    }

    if (!window.RodeShufflerParser || !window.RodeShufflerParser.removePadBinary) {
      console.error('Binary removal not available');
      return;
    }

    try {
      // Remember where the deleted pad was for finding the next selection
      const deletedAtIndex = state.slotPadIds.indexOf(padId);

      const newParsed = window.RodeShufflerParser.removePadBinary(state.parsed, padId);
      state.parsed = newParsed;

      const totalSlots = state.layout.model.totalSlots;
      const nextSlotPadIds = state.slotPadIds.slice(0, totalSlots);

      // Physical removal: pad is gone from binary, so IDs shift
      // Re-parsing reassigns sequential IDs based on array position
      for (let i = 0; i < totalSlots; i += 1) {
        const id = nextSlotPadIds[i];
        if (id === padId) {
          nextSlotPadIds[i] = null;
        } else if (id !== null && id > padId) {
          nextSlotPadIds[i] = id - 1;
        }
      }

      state.slotPadIds = nextSlotPadIds;

      rebuildLayout(false);

      // Select the next pad in visual (display) order
      if (deletedAtIndex !== -1) {
        state.selectedPadId = findNextPadInVisualOrder(deletedAtIndex);
        renderLayout();
        renderInspector();
      } else {
        state.selectedPadId = null;
      }
    } catch (error) {
      console.error('Delete failed:', error);
    }
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

          // Check if Alt key is currently pressed during dragover
          const altPressed = state.altKeyPressed || event.altKey || event.getModifierState('Alt');
          state.isDuplicating = altPressed;

          if (altPressed) {
            slotElement.classList.add("duplicate");
            // Add duplicating class to the dragged pad
            const draggedCard = document.querySelector(`[data-pad-id="${state.draggedPadId}"]`);
            if (draggedCard) {
              draggedCard.classList.add('duplicating');
            }
          } else {
            slotElement.classList.remove("duplicate");
            const draggedCard = document.querySelector(`[data-pad-id="${state.draggedPadId}"]`);
            if (draggedCard) {
              draggedCard.classList.remove('duplicating');
            }
          }
        });
        slotElement.addEventListener("dragleave", () => {
          slotElement.classList.remove("drag-over", "duplicate");
        });
        slotElement.addEventListener("drop", (event) => {
          event.preventDefault();
          slotElement.classList.remove("drag-over", "duplicate");

          if (state.draggedPadId === null) {
            return;
          }

          if (state.isDuplicating) {
            duplicatePad(state.draggedPadId, slot.absoluteIndex);
          } else {
            movePad(state.draggedPadId, slot.absoluteIndex);
          }

          state.draggedPadId = null;
          state.isDuplicating = false;
        });

        if (slot.padId === null) {
          slotElement.innerHTML = `<span class="slot-empty">Empty</span>`;
        } else {
          const pad = state.layout.padById.get(slot.padId);
          if (!pad) {
            console.error('Pad not found for slot.padId:', slot.padId);
            slotElement.innerHTML = `<span class="slot-empty">Missing Pad</span>`;
            return;
          }
          const card = document.createElement("article");
          card.className = `pad-card${state.selectedPadId === pad.id ? " selected" : ""}`;
          card.draggable = true;
          card.dataset.padId = pad.id; // Add data attribute for easy identification
          card.style.setProperty("--pad-colour", pad.colour.swatch);
          card.addEventListener("dragstart", (event) => {
            state.draggedPadId = pad.id;
          });
          card.addEventListener("dragend", () => {
            card.classList.remove('duplicating');
            state.draggedPadId = null;
            state.isDuplicating = false;
          });
          card.addEventListener("click", () => {
            state.selectedPadId = pad.id;
            renderLayout();
            renderInspector();
          });
          card.innerHTML = `
            <div class="pad-icon">
              <img src="${padTypeIcon(pad.type)}" alt="${pad.typeLabel}" />
            </div>
            <div class="pad-name">${pad.name}</div>
          `;
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
      const parsed = parseShowConfig(bytes);
      const cleaned = cleanOrphanPadEffects(parsed);
      state.parsed = cleaned.parsed;
      state.originalParsed = state.parsed;
      state.slotPadIds = null;
      state.selectedPadId = null;
      state.md5Digest = md5Bytes(bytes);
      state.md5Status = "Computed locally";
      const cleanupText = cleaned.removedCount
        ? ` Removed ${cleaned.removedCount.toLocaleString()} orphan PADEFFECTS entr${cleaned.removedCount === 1 ? "y" : "ies"} before editing.`
        : "";
      elements.uploadNote.textContent = `Loaded ${file.name} (${bytes.length.toLocaleString()} bytes). Tree root selected at byte ${state.parsed.firstNodeOffset.toLocaleString()}, SOUNDPADS at byte ${state.parsed.soundPadsNode.start.toLocaleString()}, ${state.parsed.structure.rootCount} root nodes walked.${cleanupText}`;
      rebuildLayout(true);
      if (state.parsed.pads.length) {
        state.selectedPadId = state.parsed.pads[0].id;
        renderLayout();
        renderInspector();
      }

      const md5File = elements.md5Input.files?.[0];
      if (md5File) {
        await verifyMd5File(md5File);
      }
    } catch (error) {
      state.parsed = null;
      state.originalParsed = null;
      state.slotPadIds = null;
      state.layout = null;
      state.selectedPadId = null;
      state.md5Status = "Parse failed";
      elements.uploadNote.textContent = error instanceof Error ? error.message : String(error);
      updateMetrics();
      renderLayout();
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
    if (state.originalParsed) {
      state.parsed = state.originalParsed;
      state.slotPadIds = null;
      state.selectedPadId = null;
    }
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

  // Global key listeners to track Alt key state and handle pad deletion
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Alt') {
      state.altKeyPressed = true;
    }
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;

    if (
      !isTyping &&
      (event.key === 'Delete' || event.key === 'Backspace') &&
      state.selectedPadId !== null
    ) {
      event.preventDefault();
      deletePad(state.selectedPadId);
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Alt') {
      state.altKeyPressed = false;
    }
  });

  updateMetrics();
  renderLayout();
  renderInspector();
})();
