(function attachParser(globalObject) {
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();

  const PAD_TYPE_LABELS = {
    1: "Sound",
    2: "Effect",
    3: "Mixer",
    4: "Trigger",
    6: "Action"
  };

  const PAD_TYPE_ICONS = {
    1: './res/sound.svg',
    2: './res/fx.svg',
    3: './res/mixer.svg',
    4: './res/quickdial.svg',
    6: './res/midi.svg'
  };

  const EFFECT_PAD_TYPE = 2;
  const PAD_COLOURS = {
    [-1]: { label: "Neutral", swatch: "#58626b" },
    0: { label: "Red", swatch: "#d84b49" },
    1: { label: "Orange", swatch: "#f07c3d" },
    2: { label: "Yellow", swatch: "#f2b544" },
    3: { label: "Lime", swatch: "#9fc63b" },
    4: { label: "Green", swatch: "#42b76b" },
    5: { label: "Teal", swatch: "#1fb8a6" },
    6: { label: "Blue", swatch: "#3498db" },
    7: { label: "Indigo", swatch: "#5368d9" },
    8: { label: "Purple", swatch: "#7b5ad6" },
    9: { label: "Pink", swatch: "#cf5bb3" },
    10: { label: "Rose", swatch: "#e86b8f" },
    11: { label: "Hot Pink", swatch: "#ff2d9a" }
  };

  function isPrintableByte(byte) {
    return byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126);
  }

  function isLikelyNodeName(value) {
    return /^[A-Z0-9_]{3,}$/.test(value);
  }

  function toHex(bytes, maxLength = 40) {
    const clipped = Array.from(bytes.slice(0, maxLength), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(" ");
    return bytes.length > maxLength ? `${clipped} …` : clipped;
  }

  function stripTrailingNulls(value) {
    return value.replace(/\0+$/g, "");
  }

  function readCString(bytes, offset) {
    const chars = [];
    let index = offset;

    while (index < bytes.length && bytes[index] !== 0x00) {
      if (!isPrintableByte(bytes[index])) {
        return null;
      }

      chars.push(String.fromCharCode(bytes[index]));
      index += 1;
    }

    if (index >= bytes.length) {
      return null;
    }

    return {
      next: index + 1,
      value: chars.join("")
    };
  }

  function skipZeros(bytes, offset) {
    let next = offset;
    while (next < bytes.length && bytes[next] === 0x00) {
      next += 1;
    }
    return next;
  }

  function readNodeHeader(bytes, offset) {
    const name = readCString(bytes, offset);
    if (!name || !isLikelyNodeName(name.value)) {
      return null;
    }

    const first = bytes[name.next];
    const second = bytes[name.next + 1];
    const third = bytes[name.next + 2];

    if (first === 0x01 && second !== undefined) {
      return {
        count: second,
        countOffset: name.next + 1,
        cursor: name.next + 2,
        headerLength: 2,
        headerStart: name.next,
        kind: "leaf",
        name: name.value
      };
    }

    if (first === 0x00 && second === 0x01 && third !== undefined) {
      return {
        count: third,
        countOffset: name.next + 2,
        cursor: name.next + 3,
        headerLength: 3,
        headerStart: name.next,
        kind: "container",
        name: name.value
      };
    }

    if (first === 0x00 && second === 0x00) {
      return {
        count: 0,
        countOffset: null,
        cursor: name.next + 2,
        headerLength: 2,
        headerStart: name.next,
        kind: "container",
        name: name.value
      };
    }

    return null;
  }

  function countTrailingNonZeroBytes(bytes, offset) {
    let count = 0;

    for (let index = offset; index < bytes.length; index += 1) {
      if (bytes[index] !== 0x00) {
        count += 1;
      }
    }

    return count;
  }

  function compareCandidateScores(left, right) {
    if (!right) {
      return -1;
    }

    if (left.trailingNonZeroBytes !== right.trailingNonZeroBytes) {
      return left.trailingNonZeroBytes - right.trailingNonZeroBytes;
    }

    if (left.trailingBytes !== right.trailingBytes) {
      return left.trailingBytes - right.trailingBytes;
    }

    if (left.coverage !== right.coverage) {
      return right.coverage - left.coverage;
    }

    if (left.rootCount !== right.rootCount) {
      return right.rootCount - left.rootCount;
    }

    return left.offset - right.offset;
  }

  function findBestRootParse(bytes) {
    let candidateCount = 0;
    let best = null;
    let successfulCandidates = 0;

    for (let offset = 0; offset < bytes.length; offset += 1) {
      const byte = bytes[offset];
      const isNameStart =
        (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || byte === 0x5f;

      if (!isNameStart) {
        continue;
      }

      const header = readNodeHeader(bytes, offset);
      if (!header) {
        continue;
      }

      candidateCount += 1;

      try {
        const parseResult = parseRoots(bytes, offset);
        successfulCandidates += 1;
        const score = {
          coverage: parseResult.end - offset,
          offset,
          parseResult,
          rootCount: parseResult.roots.length,
          trailingBytes: bytes.length - parseResult.end,
          trailingNonZeroBytes: countTrailingNonZeroBytes(bytes, parseResult.end)
        };

        if (compareCandidateScores(score, best) < 0) {
          best = score;
        }

        if (score.trailingBytes === 0 && score.trailingNonZeroBytes === 0) {
          return {
            candidateCount,
            end: parseResult.end,
            offset,
            roots: parseResult.roots,
            successfulCandidates,
            trailingBytes: score.trailingBytes,
            trailingNonZeroBytes: score.trailingNonZeroBytes
          };
        }
      } catch (error) {
        // Invalid candidate; keep searching for a cleaner full-tree parse.
      }
    }

    if (!best) {
      return null;
    }

    return {
      candidateCount,
      end: best.parseResult.end,
      offset: best.offset,
      roots: best.parseResult.roots,
      successfulCandidates,
      trailingBytes: best.trailingBytes,
      trailingNonZeroBytes: best.trailingNonZeroBytes
    };
  }

  function decodeFieldValue(payload) {
    if (!payload.length) {
      return {
        kind: "empty",
        pretty: "(empty)"
      };
    }

    if (payload.length === 1) {
      const raw = payload[0];
      if (raw === 0x02 || raw === 0x03) {
        return {
          bool: raw === 0x03,
          kind: "bool",
          pretty: raw === 0x03 ? "true" : "false"
        };
      }

      return {
        kind: "byte",
        numeric: raw,
        pretty: `${raw}`
      };
    }

    if (payload[0] === 0x05) {
      const text = stripTrailingNulls(textDecoder.decode(payload.slice(1)));
      return {
        kind: "string",
        pretty: text || "(empty string)",
        text
      };
    }

    if (payload[0] === 0x01 && payload.length === 5) {
      const numeric = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength
      ).getInt32(1, true);

      return {
        kind: "int32",
        numeric,
        pretty: `${numeric}`
      };
    }

    if (payload[0] === 0x04 && payload.length === 9) {
      const numeric = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength
      ).getFloat64(1, true);

      return {
        kind: "float64",
        numeric,
        pretty: Number.isFinite(numeric) ? `${numeric}` : "NaN"
      };
    }

    return {
      kind: "bytes",
      pretty: toHex(payload)
    };
  }

  function readField(bytes, offset) {
    const name = readCString(bytes, offset);
    if (!name) {
      throw new Error(`Could not read field name at byte ${offset}.`);
    }

    const lengthType = bytes[name.next];
    let payloadLength = 0;
    let payloadStart = 0;

    if (lengthType === 0x01) {
      payloadLength = bytes[name.next + 1];
      payloadStart = name.next + 2;
    } else if (lengthType === 0x02) {
      payloadLength = bytes[name.next + 1] | (bytes[name.next + 2] << 8);
      payloadStart = name.next + 3;
    } else {
      throw new Error(
        `Unsupported field length marker 0x${lengthType.toString(16)} at byte ${offset}.`
      );
    }

    const payloadEnd = payloadStart + payloadLength;
    if (payloadEnd > bytes.length) {
      throw new Error(`Field ${name.value} overruns the end of the file.`);
    }

    const payload = bytes.slice(payloadStart, payloadEnd);

    return {
      decoded: decodeFieldValue(payload),
      end: payloadEnd,
      lengthType,
      name: name.value,
      payload,
      payloadLength,
      payloadStart,
      start: offset
    };
  }

  function parseNode(bytes, offset) {
    const nodeOffset = skipZeros(bytes, offset);
    const header = readNodeHeader(bytes, nodeOffset);

    if (!header) {
      throw new Error(`Could not read node name at byte ${nodeOffset}.`);
    }

    let cursor = header.cursor;
    const items = [];
    for (let index = 0; index < header.count; index += 1) {
      cursor = skipZeros(bytes, cursor);

      if (header.kind === "container") {
        const child = parseNode(bytes, cursor);
        items.push(child);
        cursor = child.end;
      } else {
        const field = readField(bytes, cursor);
        items.push(field);
        cursor = field.end;
      }
    }

    return {
      count: header.count,
      countOffset: header.countOffset,
      end: cursor,
      headerLength: header.headerLength,
      headerStart: header.headerStart,
      items,
      kind: header.kind,
      name: header.name,
      start: nodeOffset
    };
  }

  function parseRoots(bytes, offset) {
    const roots = [];
    let cursor = offset;

    while (cursor < bytes.length) {
      cursor = skipZeros(bytes, cursor);
      if (cursor >= bytes.length) {
        break;
      }

      const root = parseNode(bytes, cursor);
      roots.push(root);
      cursor = root.end;
    }

    return {
      end: cursor,
      roots
    };
  }

  function intField(field) {
    return field?.decoded.kind === "int32" ? field.decoded.numeric : null;
  }

  function stringField(field) {
    return field?.decoded.kind === "string" ? field.decoded.text : "";
  }

  function floatField(field) {
    return field?.decoded.kind === "float64" ? field.decoded.numeric : null;
  }

  function boolField(field) {
    return field?.decoded.kind === "bool" ? field.decoded.bool : null;
  }

  function padColour(index) {
    return PAD_COLOURS[index] || { label: `Index ${index}`, swatch: "#8a939b" };
  }

  function padTypeLabel(type) {
    return PAD_TYPE_LABELS[type] || `Type ${type}`;
  }

  function padTypeIcon(type) {
    return PAD_TYPE_ICONS[type] || '';
  }

  function buildPad(node, id) {
    const fieldsByName = new Map(node.items.map((field) => [field.name, field]));
    const absoluteIndex =
      intField(fieldsByName.get("padIdx")) ??
      intField(fieldsByName.get("padTriggerControl")) ??
      id;
    const colourIndex = intField(fieldsByName.get("padColourIndex")) ?? -1;
    const type = intField(fieldsByName.get("padType")) ?? -1;

    return {
      absoluteIndex,
      active: boolField(fieldsByName.get("padActive")),
      colour: padColour(colourIndex),
      colourIndex,
      effectInput: intField(fieldsByName.get("padEffectInput")),
      effectTriggerMode: intField(fieldsByName.get("padEffectTriggerMode")),
      fields: node.items,
      fieldsByName,
      filePath: stringField(fieldsByName.get("padFilePath")),
      gain: floatField(fieldsByName.get("padGain")),
      id,
      loop: boolField(fieldsByName.get("padLoop")),
      mixerMode: intField(fieldsByName.get("padMixerMode")),
      name: stringField(fieldsByName.get("padName")) || `Pad ${absoluteIndex + 1}`,
      node,
      playMode: intField(fieldsByName.get("padPlayMode")),
      progress: floatField(fieldsByName.get("padProgress")),
      rawType: type,
      replay: boolField(fieldsByName.get("padReplay")),
      rcvSyncPadType: intField(fieldsByName.get("padRCVSyncPadType")),
      triggerControl: intField(fieldsByName.get("padTriggerControl")),
      type,
      typeLabel: padTypeLabel(type)
    };
  }

  function countBy(items, keyGetter) {
    const counts = new Map();

    items.forEach((item) => {
      const key = keyGetter(item);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return counts;
  }

  function inferModel(strings, pads) {
    const joined = strings.join(" ").toLowerCase();
    const maxIndex = Math.max(-1, ...pads.map((pad) => pad.absoluteIndex));

    if (joined.includes("duo")) {
      return {
        confidence: "explicit",
        key: "duo",
        label: "RØDECaster Duo",
        padsPerBank: 6,
        totalSlots: 48
      };
    }

    if (
      joined.includes("pro ii") ||
      joined.includes("proii") ||
      joined.includes("pro_ii")
    ) {
      return {
        confidence: "explicit",
        key: "proii",
        label: "RØDECaster Pro II",
        padsPerBank: 8,
        totalSlots: 64
      };
    }

    if (maxIndex >= 48) {
      return {
        confidence: "slot-range",
        key: "proii",
        label: "Likely RØDECaster Pro II",
        padsPerBank: 8,
        totalSlots: 64
      };
    }

    return {
      confidence: maxIndex >= 42 ? "slot-range" : "fallback",
      key: "duo",
      label: "RØDECaster Duo",
      padsPerBank: 6,
      totalSlots: 48
    };
  }

  function findSoundPadsNode(roots) {
    return roots.find((node) => node.name === "SOUNDPADS") || null;
  }

  function findPadEffectsNode(roots) {
    return roots.find((node) => node.name === "PADEFFECTS") || null;
  }

  function isEffectPad(pad) {
    return pad?.rawType === EFFECT_PAD_TYPE || pad?.type === EFFECT_PAD_TYPE;
  }

  function buildPadEffect(node, id) {
    const fieldsByName = new Map(node.items.map((field) => [field.name, field]));
    const effectsIdxField = fieldsByName.get("effectsIdx") || null;

    return {
      effectsIdx: intField(effectsIdxField),
      effectsIdxField,
      fields: node.items,
      fieldsByName,
      id,
      node
    };
  }

  function collectPadEffects(padEffectsNode) {
    if (!padEffectsNode || padEffectsNode.kind !== "container") {
      return [];
    }

    return padEffectsNode.items
      .filter((node) => node.name === "EFFECTS_PARAMETERS" && node.kind === "leaf")
      .map((node, index) => buildPadEffect(node, index));
  }

  function linkPadEffectsToPads(pads, padEffects) {
    const linkedEffectIds = new Set();

    pads.forEach((pad) => {
      pad.padEffect = null;
      pad.padEffectId = null;

      if (!isEffectPad(pad)) {
        return;
      }

      const candidates = padEffects.filter(
        (effect) =>
          effect.effectsIdx === pad.absoluteIndex && !linkedEffectIds.has(effect.id)
      );

      const padEffect = candidates[candidates.length - 1] || null;
      if (!padEffect) {
        return;
      }

      pad.padEffect = padEffect;
      pad.padEffectId = padEffect.id;
      linkedEffectIds.add(padEffect.id);
    });
  }

  function findLinkedPadEffect(parsed, pad) {
    if (!parsed || !pad || !isEffectPad(pad)) {
      return null;
    }

    if (pad.padEffectId !== null && pad.padEffectId !== undefined) {
      const linked = parsed.padEffects.find((effect) => effect.id === pad.padEffectId);
      if (linked) {
        return linked;
      }
    }

    return findPadEffectByIndex(parsed, pad.absoluteIndex);
  }

  function findPadEffectByIndex(parsed, effectsIdx) {
    if (!parsed || !Array.isArray(parsed.padEffects)) {
      return null;
    }

    const candidates = parsed.padEffects.filter(
      (effect) => effect.effectsIdx === effectsIdx
    );
    return candidates[candidates.length - 1] || null;
  }

  function canRemovePadEffect(parsed, padEffect) {
    return Boolean(parsed && padEffect);
  }

  function analyzePadEffectsStructure(padEffectsNode, bytes) {
    if (!padEffectsNode) return null;

    const analysis = {
      name: padEffectsNode.name,
      kind: padEffectsNode.kind,
      count: padEffectsNode.count,
      children: []
    };

    // PADEFFECTS is a container, so its items are child nodes
    if (padEffectsNode.kind === "container") {
      padEffectsNode.items.forEach((item, index) => {
        const childInfo = {
          index,
          name: item.name,
          kind: item.kind,
          count: item.count,
          offset: item.start,
          rawBytes: bytes.slice(item.start, item.start + 20).map(b => b.toString(16).padStart(2, '0')).join(' '),
          fields: []
        };

        // If this child is a leaf, its items are fields
        if (item.kind === "leaf") {
          item.items.forEach(field => {
            // Analyze the raw bytes before the field name to understand prefix structure
            const prefixBytes = [];
            let tempOffset = field.start;
            while (tempOffset < bytes.length && bytes[tempOffset] !== 0x00) {
              const byte = bytes[tempOffset];
              if (byte >= 65 && byte <= 90) { // Uppercase letter - start of name
                break;
              }
              prefixBytes.push(byte);
              tempOffset++;
            }

            childInfo.fields.push({
              name: field.name,
              offset: field.start,
              prefixBytes: prefixBytes.map(b => b.toString(16).padStart(2, '0')).join(' '),
              prefixDecimal: prefixBytes.map(b => b),
              rawBytes: bytes.slice(field.start, field.start + 20).map(b => b.toString(16).padStart(2, '0')).join(' '),
              type: field.lengthType,
              len: field.payloadLength,
              value: field.decoded ? (field.decoded.numeric !== undefined ? field.decoded.numeric : field.decoded.bool !== undefined ? field.decoded.bool : field.decoded.pretty) : null
            });
          });
        }

        analysis.children.push(childInfo);
      });
    }

    return analysis;
  }

  function findInputSourceNode(roots) {
    for (const node of roots) {
      if (node.name === "INPUTSOURCE" && node.kind === "leaf") {
        return node;
      }
      if (node.kind === "container") {
        const found = node.items.find((child) => child.name === "INPUTSOURCE" && child.kind === "leaf");
        if (found) return found;
      }
    }
    return null;
  }

  function findInputIdField(inputSourceNode) {
    if (!inputSourceNode || inputSourceNode.kind !== "leaf") return null;
    return inputSourceNode.items.find((field) => field.name === "inputId");
  }

  function walkNodes(nodes, visitor, depth = 0) {
    nodes.forEach((node) => {
      visitor(node, depth);

      if (node.kind === "container") {
        walkNodes(node.items, visitor, depth + 1);
      }
    });
  }

  function summarizeStructure(roots, bytes, parseStart, parseEnd, parseMeta) {
    const nodeNameCounts = new Map();
    const rootNameCounts = new Map();
    const fieldLengthCounts = new Map();
    const fieldTagCounts = new Map();
    const fieldSummaries = new Map();
    const containers = [];
    let containerCount = 0;
    let leafCount = 0;
    let maxDepth = 0;

    roots.forEach((node) => {
      rootNameCounts.set(node.name, (rootNameCounts.get(node.name) || 0) + 1);
    });

    walkNodes(roots, (node, depth) => {
      nodeNameCounts.set(node.name, (nodeNameCounts.get(node.name) || 0) + 1);
      maxDepth = Math.max(maxDepth, depth);

      if (node.kind === "container") {
        containerCount += 1;
        containers.push({
          count: node.count,
          end: node.end,
          name: node.name,
          start: node.start
        });
        return;
      }

      leafCount += 1;
      node.items.forEach((field) => {
        fieldLengthCounts.set(
          field.lengthType,
          (fieldLengthCounts.get(field.lengthType) || 0) + 1
        );

        const firstByte = field.payload[0] ?? -1;
        fieldTagCounts.set(firstByte, (fieldTagCounts.get(firstByte) || 0) + 1);

        if (field.lengthType !== 2) {
          return;
        }

        const key = `${node.name}.${field.name}`;
        if (!fieldSummaries.has(key)) {
          fieldSummaries.set(key, {
            count: 0,
            lengths: new Set(),
            nodeName: node.name,
            fieldName: field.name
          });
        }

        const summary = fieldSummaries.get(key);
        summary.count += 1;
        summary.lengths.add(field.payloadLength);
      });
    });

    const twoByteLengthFields = Array.from(fieldSummaries.values()).map((entry) => ({
      count: entry.count,
      fieldName: entry.fieldName,
      lengths: Array.from(entry.lengths).sort((left, right) => left - right),
      nodeName: entry.nodeName
    }));

    return {
      containerCount,
      containers,
      fieldLengthCounts: Array.from(fieldLengthCounts.entries()).sort((left, right) => left[0] - right[0]),
      fieldTagCounts: Array.from(fieldTagCounts.entries()).sort((left, right) => right[1] - left[1]),
      leafCount,
      maxDepth,
      nodeNameCounts: Array.from(nodeNameCounts.entries()).sort((left, right) => right[1] - left[1]),
      parseCoverage: parseEnd - parseStart,
      parseEnd,
      parseStart,
      rootCount: roots.length,
      rootNameCounts: Array.from(rootNameCounts.entries()).sort((left, right) => right[1] - left[1]),
      trailingBytes: bytes.length - parseEnd,
      trailingNonZeroBytes: countTrailingNonZeroBytes(bytes, parseEnd),
      twoByteLengthFields,
      validation: {
        candidateCount: parseMeta.candidateCount,
        successfulCandidates: parseMeta.successfulCandidates
      }
    };
  }

  function summarizeFindings(parsed) {
    const typeCounts = countBy(parsed.pads, (pad) => pad.typeLabel);
    const typeSummary = Array.from(typeCounts.entries())
      .map(([label, count]) => `${count} ${label}`)
      .join(", ");
    const matchingControls = parsed.pads.filter(
      (pad) => pad.triggerControl === null || pad.triggerControl === pad.absoluteIndex
    ).length;
    const effectPads = parsed.pads.filter((pad) => isEffectPad(pad));
    const linkedEffectPads = effectPads.filter((pad) => pad.padEffect).length;
    const maxIndex = Math.max(-1, ...parsed.pads.map((pad) => pad.absoluteIndex));
    const fieldCountSummary = Array.from(
      countBy(parsed.pads, (pad) => pad.fields.length).entries()
    )
      .sort((left, right) => left[0] - right[0])
      .map(([fieldCount, count]) => `${count} PADs have ${fieldCount} fields`)
      .join(", ");
    const containerSummary = parsed.structure.containers
      .map((container) => `${container.name} (${container.count})`)
      .join(", ");
    const wideFieldSummary = parsed.structure.twoByteLengthFields
      .map((entry) => `${entry.nodeName}.${entry.fieldName}`)
      .join(", ");
    const topRootsSummary = parsed.structure.rootNameCounts
      .slice(0, 5)
      .map(([name, count]) => `${name} (${count})`)
      .join(", ");

    return [
      `Parser tested ${parsed.parseValidation.candidateCount.toLocaleString()} candidate node start${parsed.parseValidation.candidateCount === 1 ? "" : "s"} before finding a clean full-file parse at byte ${parsed.firstNodeOffset.toLocaleString()}.`,
      `The tree walk consumes ${parsed.structure.parseEnd.toLocaleString()} of ${parsed.bytes.length.toLocaleString()} bytes, leaving ${parsed.structure.trailingBytes} trailing byte${parsed.structure.trailingBytes === 1 ? "" : "s"} (${parsed.parseValidation.trailingNonZeroBytes} non-zero).`,
      `Top level contains ${parsed.structure.rootCount} root nodes; ${parsed.structure.containerCount} are containers and ${parsed.structure.leafCount} are leaf objects at a maximum depth of ${parsed.structure.maxDepth + 1}.`,
      topRootsSummary
        ? `Most common top-level nodes: ${topRootsSummary}.`
        : "No top-level nodes were decoded.",
      containerSummary
        ? `Container sections found: ${containerSummary}.`
        : "No container sections were found.",
      `SOUNDPADS starts at byte ${parsed.soundPadsNode.start.toLocaleString()} and declares ${parsed.soundPadsNode.count} child PAD objects.`,
      fieldCountSummary
        ? `PAD field counts in this file: ${fieldCountSummary}.`
        : "No PAD fields were decoded.",
      wideFieldSummary
        ? `Two-byte field lengths appear only on: ${wideFieldSummary}.`
        : "All decoded fields in this file use one-byte payload lengths.",
      `${matchingControls}/${parsed.pads.length} pads have padIdx and padTriggerControl set to the same absolute slot.`,
      parsed.padEffectsNode
        ? `PADEFFECTS declares ${parsed.padEffectsNode.count} EFFECTS_PARAMETERS objects; ${linkedEffectPads}/${effectPads.length} effect pads have a matching effectsIdx entry.`
        : "No PADEFFECTS section was decoded.",
      `Highest slot index is ${maxIndex}, which fits the ${parsed.autoModel.totalSlots}-slot ${parsed.autoModel.label} layout.`,
      typeSummary ? `Pad types found: ${typeSummary}.` : "No pad types were decoded."
    ];
  }

  function collectAsciiStrings(bytes, minimumLength = 4) {
    const results = [];
    let current = [];

    for (let index = 0; index < bytes.length; index += 1) {
      if (isPrintableByte(bytes[index]) && bytes[index] !== 0x00) {
        current.push(String.fromCharCode(bytes[index]));
      } else {
        if (current.length >= minimumLength) {
          results.push(current.join(""));
        }
        current = [];
      }
    }

    if (current.length >= minimumLength) {
      results.push(current.join(""));
    }

    return results;
  }

  function parseShowConfig(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const parseResult = findBestRootParse(bytes);

    if (!parseResult) {
      throw new Error("Could not find the first structured RØDECaster node.");
    }

    const soundPadsNode = findSoundPadsNode(parseResult.roots);
    const padEffectsNode = findPadEffectsNode(parseResult.roots);

    if (!soundPadsNode) {
      throw new Error("This file does not contain a SOUNDPADS section.");
    }

    const pads = soundPadsNode.items
      .filter((node) => node.name === "PAD" && node.kind === "leaf")
      .map((node, index) => buildPad(node, index));
    const padEffects = collectPadEffects(padEffectsNode);
    linkPadEffectsToPads(pads, padEffects);

    const strings = collectAsciiStrings(bytes);
    const autoModel = inferModel(strings, pads);

    const parsed = {
      autoModel,
      bytes,
      firstNodeOffset: parseResult.offset,
      findings: [],
      parseValidation: {
        candidateCount: parseResult.candidateCount,
        successfulCandidates: parseResult.successfulCandidates,
        trailingBytes: parseResult.trailingBytes,
        trailingNonZeroBytes: parseResult.trailingNonZeroBytes
      },
      padEffects,
      padEffectsNode,
      pads,
      roots: parseResult.roots,
      soundPadsNode,
      structure: summarizeStructure(
        parseResult.roots,
        bytes,
        parseResult.offset,
        parseResult.end,
        parseResult
      ),
      strings
    };

    parsed.findings = summarizeFindings(parsed);
    return parsed;
  }

  function resolveModel(parsed, override = "auto") {
    if (override === "duo") {
      return {
        confidence: "manual",
        key: "duo",
        label: "RØDECaster Duo",
        padsPerBank: 6,
        totalSlots: 48
      };
    }

    if (override === "proii") {
      return {
        confidence: "manual",
        key: "proii",
        label: "RØDECaster Pro II",
        padsPerBank: 8,
        totalSlots: 64
      };
    }

    return parsed.autoModel;
  }

  function normaliseSlots(parsed, model, slotPadIds) {
    const slots = Array.from({ length: model.totalSlots }, () => null);
    const assigned = new Set();

    if (Array.isArray(slotPadIds)) {
      slotPadIds.slice(0, model.totalSlots).forEach((padId, absoluteIndex) => {
        if (padId === null || padId === undefined || assigned.has(padId)) {
          return;
        }

        slots[absoluteIndex] = padId;
        assigned.add(padId);
      });
    }

    parsed.pads.forEach((pad) => {
      if (assigned.has(pad.id)) {
        return;
      }

      if (
        Number.isInteger(pad.absoluteIndex) &&
        pad.absoluteIndex >= 0 &&
        pad.absoluteIndex < model.totalSlots &&
        slots[pad.absoluteIndex] === null
      ) {
        slots[pad.absoluteIndex] = pad.id;
        assigned.add(pad.id);
      }
    });

    parsed.pads.forEach((pad) => {
      if (assigned.has(pad.id)) {
        return;
      }

      const firstFree = slots.indexOf(null);
      if (firstFree !== -1) {
        slots[firstFree] = pad.id;
        assigned.add(pad.id);
      }
    });

    const overflowPads = parsed.pads.filter((pad) => !assigned.has(pad.id));
    return { overflowPads, slots };
  }

  function buildLayout(parsed, options = {}) {
    const model = resolveModel(parsed, options.modelOverride);
    const normalised = normaliseSlots(parsed, model, options.slotPadIds);
    const padById = new Map(parsed.pads.map((pad) => [pad.id, pad]));
    const banks = Array.from({ length: 8 }, (_, bankIndex) => {
      const start = bankIndex * model.padsPerBank;
      const end = start + model.padsPerBank;

      return {
        bankIndex,
        filledSlots: normalised.slots.slice(start, end).filter((padId) => padId !== null).length,
        slots: normalised.slots.slice(start, end).map((padId, slotOffset) => ({
          absoluteIndex: start + slotOffset,
          bankIndex,
          padId,
          slotIndex: slotOffset
        }))
      };
    });

    return {
      banks,
      model,
      overflowPads: normalised.overflowPads,
      padById,
      slotPadIds: normalised.slots,
      usedSlots: normalised.slots.filter((padId) => padId !== null).length
    };
  }

  function patchIntField(bytes, field, value) {
    if (!field || field.decoded.kind !== "int32" || field.payloadLength !== 5) {
      return;
    }

    new DataView(bytes.buffer, bytes.byteOffset + field.payloadStart, field.payloadLength).setInt32(
      1,
      value,
      true
    );
  }

  function exportRemappedBinary(parsed, slotPadIds) {
    parsed = cleanOrphanPadEffects(parsed).parsed;
    const output = parsed.bytes.slice();
    const slotToPadId = Array.isArray(slotPadIds) ? slotPadIds : [];
    const patchedPadEffectIds = new Set();
    const linkedPadEffectIds = new Set(
      parsed.pads
        .filter((pad) => isEffectPad(pad) && pad.padEffectId !== null && pad.padEffectId !== undefined)
        .map((pad) => pad.padEffectId)
    );
    const padEffectOperations = [];
    let padEffectCountDelta = 0;

    slotToPadId.forEach((padId, absoluteIndex) => {
      if (padId === null || padId === undefined) {
        return;
      }

      const pad = parsed.pads.find((entry) => entry.id === padId);
      if (!pad) {
        return;
      }

      patchIntField(output, pad.fieldsByName.get("padIdx"), absoluteIndex);
      patchIntField(output, pad.fieldsByName.get("padTriggerControl"), absoluteIndex);

      if (!isEffectPad(pad)) {
        return;
      }

      const padEffect = findLinkedPadEffect(parsed, pad);
      if (!padEffect || patchedPadEffectIds.has(padEffect.id)) {
        return;
      }

      const targetEffect = findPadEffectByIndex(parsed, absoluteIndex);
      const targetEffectIsAvailable =
        targetEffect &&
        targetEffect.id !== padEffect.id &&
        !linkedPadEffectIds.has(targetEffect.id);

      if (targetEffectIsAvailable) {
        const effectBytes = copyNodeWithPatchedInts(parsed.bytes, padEffect.node, [
          {
            field: padEffect.effectsIdxField,
            value: absoluteIndex
          }
        ]);

        padEffectOperations.push(replaceNodeOperation(targetEffect.node, effectBytes));
        padEffectOperations.push(removeNodeOperation(parsed.bytes, padEffect.node));
        padEffectCountDelta -= 1;

        patchedPadEffectIds.add(padEffect.id);
        return;
      }

      patchIntField(output, padEffect.effectsIdxField, absoluteIndex);
      patchedPadEffectIds.add(padEffect.id);
    });

    if (padEffectCountDelta !== 0 && parsed.padEffectsNode) {
      padEffectOperations.push(
        nodeCountOperation(parsed.padEffectsNode, parsed.padEffectsNode.count + padEffectCountDelta)
      );
    }

    return {
      bytes: applyBinaryOperations(output, padEffectOperations)
    };
  }

  function formatPadFields(pad) {
    return pad.fields.map((field) => ({
      label: field.name,
      value: field.decoded.pretty
    }));
  }

  function encodeCString(value) {
    return Uint8Array.from([...textEncoder.encode(value), 0x00]);
  }

  function concatBytes(parts) {
    const totalLength = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;

    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });

    return output;
  }

  function encodeField(name, payload) {
    const nameBytes = encodeCString(name);

    if (payload.length <= 255) {
      return concatBytes([nameBytes, Uint8Array.from([0x01, payload.length]), payload]);
    }

    if (payload.length > 65535) {
      throw new Error(`Field ${name} is too large.`);
    }

    return concatBytes([
      nameBytes,
      Uint8Array.from([0x02, payload.length & 0xff, payload.length >> 8]),
      payload
    ]);
  }

  function encodeStringField(name, value) {
    return encodeField(name, concatBytes([Uint8Array.from([0x05]), encodeCString(value)]));
  }

  function rangeOperation(start, end, bytes) {
    return { bytes, end, start };
  }

  function applyBinaryOperations(bytes, operations) {
    return operations
      .filter(Boolean)
      .slice()
      .sort((left, right) => {
        if (left.start !== right.start) {
          return right.start - left.start;
        }

        return right.end - left.end;
      })
      .reduce((current, operation) => {
        const next = new Uint8Array(
          current.length - (operation.end - operation.start) + operation.bytes.length
        );
        next.set(current.slice(0, operation.start), 0);
        next.set(operation.bytes, operation.start);
        next.set(current.slice(operation.end), operation.start + operation.bytes.length);
        return next;
      }, bytes);
  }

  function nodeCountOperation(node, nextCount) {
    if (!node) {
      throw new Error("Cannot update count on a missing node.");
    }

    if (!Number.isInteger(nextCount) || nextCount < 0 || nextCount > 255) {
      throw new Error(`Unsupported node count ${nextCount}.`);
    }

    if (node.kind === "container") {
      const headerBytes =
        nextCount === 0
          ? Uint8Array.from([0x00, 0x00])
          : Uint8Array.from([0x00, 0x01, nextCount]);

      return rangeOperation(
        node.headerStart,
        node.headerStart + node.headerLength,
        headerBytes
      );
    }

    if (node.countOffset === null || node.countOffset === undefined) {
      throw new Error(`Cannot update count for ${node.name}.`);
    }

    return rangeOperation(node.countOffset, node.countOffset + 1, Uint8Array.from([nextCount]));
  }

  function withTrailingSeparator(bytes) {
    const output = new Uint8Array(bytes.length + 1);
    output.set(bytes, 0);
    output[bytes.length] = 0x00;
    return output;
  }

  function removeNodeOperation(bytes, node) {
    const end = bytes[node.end] === 0x00 ? node.end + 1 : node.end;
    return rangeOperation(node.start, end, new Uint8Array(0));
  }

  function appendChildNodeOperation(bytes, container, nodeBytes) {
    const hasBoundarySeparator = bytes[container.end] === 0x00;
    const insertOffset =
      container.count > 0 && hasBoundarySeparator ? container.end + 1 : container.end;

    return rangeOperation(insertOffset, insertOffset, withTrailingSeparator(nodeBytes));
  }

  function replaceNodeOperation(node, bytes) {
    return rangeOperation(node.start, node.end, bytes);
  }

  function patchIntFieldInNodeCopy(nodeBytes, sourceNode, field, value) {
    if (!field || field.decoded.kind !== "int32" || field.payloadLength !== 5) {
      return;
    }

    const relativePayloadStart = field.payloadStart - sourceNode.start;
    new DataView(
      nodeBytes.buffer,
      nodeBytes.byteOffset + relativePayloadStart,
      field.payloadLength
    ).setInt32(1, value, true);
  }

  function copyNodeWithPatchedInts(bytes, sourceNode, patches) {
    const nodeBytes = bytes.slice(sourceNode.start, sourceNode.end);
    patches.forEach(({ field, value }) => {
      patchIntFieldInNodeCopy(nodeBytes, sourceNode, field, value);
    });
    return nodeBytes;
  }

  function replaceFieldOperation(field, bytes) {
    return rangeOperation(field.start, field.end, bytes);
  }

  function linkedPadEffectIds(parsed) {
    const ids = new Set();

    if (!parsed || !Array.isArray(parsed.pads)) {
      return ids;
    }

    parsed.pads.forEach((pad) => {
      if (
        isEffectPad(pad) &&
        pad.padEffectId !== null &&
        pad.padEffectId !== undefined
      ) {
        ids.add(pad.padEffectId);
      }
    });

    return ids;
  }

  function cleanOrphanPadEffects(parsed) {
    if (!parsed?.padEffectsNode || !Array.isArray(parsed.padEffects)) {
      return {
        bytes: parsed?.bytes,
        parsed,
        removedCount: 0
      };
    }

    const keepEffectIds = linkedPadEffectIds(parsed);
    const orphanEffects = parsed.padEffects.filter(
      (effect) => !keepEffectIds.has(effect.id)
    );

    if (!orphanEffects.length) {
      return {
        bytes: parsed.bytes,
        parsed,
        removedCount: 0
      };
    }

    const operations = orphanEffects.map((effect) =>
      removeNodeOperation(parsed.bytes, effect.node)
    );
    operations.push(nodeCountOperation(parsed.padEffectsNode, keepEffectIds.size));

    const bytes = applyBinaryOperations(parsed.bytes, operations);
    return {
      bytes,
      parsed: parseShowConfig(bytes),
      removedCount: orphanEffects.length
    };
  }

  function renamePadBinary(parsed, padId, nextName) {
    parsed = cleanOrphanPadEffects(parsed).parsed;
    const pad = parsed.pads.find((p) => p.id === padId);
    if (!pad || !pad.node) {
      throw new Error(`Pad ${padId} not found`);
    }

    const field = pad.fieldsByName.get("padName");
    if (!field || field.decoded.kind !== "string") {
      throw new Error(`Pad ${padId} does not have an editable padName field.`);
    }

    const name = String(nextName ?? "").trim();
    if (!name) {
      throw new Error("Pad name cannot be empty.");
    }

    const bytes = applyBinaryOperations(parsed.bytes, [
      replaceFieldOperation(field, encodeStringField("padName", name))
    ]);
    return parseShowConfig(bytes);
  }

  function updatePadEffectInputBinary(parsed, padId, nextInput) {
    parsed = cleanOrphanPadEffects(parsed).parsed;
    const pad = parsed.pads.find((p) => p.id === padId);
    if (!pad || !pad.node) {
      throw new Error(`Pad ${padId} not found`);
    }

    if (!isEffectPad(pad)) {
      throw new Error("Only FX pads have an editable input source.");
    }

    const field = pad.fieldsByName.get("padEffectInput");
    if (!field || field.decoded.kind !== "int32" || field.payloadLength !== 5) {
      throw new Error(`Pad ${padId} does not have an editable padEffectInput field.`);
    }

    const input = Number(nextInput);
    if (!Number.isInteger(input)) {
      throw new Error(`Invalid FX input ${nextInput}.`);
    }

    const output = parsed.bytes.slice();
    patchIntField(output, field, input);
    return parseShowConfig(output);
  }

  function removePadBinary(parsed, padId) {
    parsed = cleanOrphanPadEffects(parsed).parsed;
    const pad = parsed.pads.find((p) => p.id === padId);
    if (!pad || !pad.node) {
      throw new Error(`Pad ${padId} not found`);
    }

    const soundPadsNode = parsed.soundPadsNode;
    if (!soundPadsNode || soundPadsNode.kind !== "container") {
      throw new Error("SOUNDPADS container not found");
    }

    const operations = [
      removeNodeOperation(parsed.bytes, pad.node),
      nodeCountOperation(soundPadsNode, soundPadsNode.count - 1)
    ];

    if (isEffectPad(pad) && parsed.padEffectsNode) {
      const padEffect = findLinkedPadEffect(parsed, pad);
      if (padEffect && canRemovePadEffect(parsed, padEffect)) {
        operations.push(removeNodeOperation(parsed.bytes, padEffect.node));
        operations.push(nodeCountOperation(parsed.padEffectsNode, parsed.padEffectsNode.count - 1));
      }
    }

    const newBytes = applyBinaryOperations(parsed.bytes, operations);
    return parseShowConfig(newBytes);
  }

  function duplicatePadBinary(parsed, sourcePadId, targetAbsoluteIndex, overwriteTargetId) {
    parsed = cleanOrphanPadEffects(parsed).parsed;
    const sourcePad = parsed.pads.find((p) => p.id === sourcePadId);
    if (!sourcePad || !sourcePad.node) {
      throw new Error(`Source pad ${sourcePadId} not found`);
    }

    const soundPadsNode = parsed.soundPadsNode;
    if (!soundPadsNode || soundPadsNode.kind !== "container") {
      throw new Error("SOUNDPADS container not found");
    }

    if (!Number.isInteger(targetAbsoluteIndex) || targetAbsoluteIndex < 0) {
      throw new Error(`Invalid target slot ${targetAbsoluteIndex}.`);
    }

    const operations = [];
    const sourceBytes = copyNodeWithPatchedInts(parsed.bytes, sourcePad.node, [
      {
        field: sourcePad.fieldsByName.get("padIdx"),
        value: targetAbsoluteIndex
      },
      {
        field: sourcePad.fieldsByName.get("padTriggerControl"),
        value: targetAbsoluteIndex
      }
    ]);

    let targetPad = null;
    if (overwriteTargetId !== undefined && overwriteTargetId !== null) {
      targetPad = parsed.pads.find((p) => p.id === overwriteTargetId);
      if (!targetPad || !targetPad.node) {
        throw new Error(`Target pad ${overwriteTargetId} not found for overwrite`);
      }

      operations.push(replaceNodeOperation(targetPad.node, sourceBytes));
    } else {
      operations.push(appendChildNodeOperation(parsed.bytes, soundPadsNode, sourceBytes));
      operations.push(nodeCountOperation(soundPadsNode, soundPadsNode.count + 1));
    }

    if (parsed.padEffectsNode) {
      if (isEffectPad(sourcePad)) {
        const sourceEffect = findLinkedPadEffect(parsed, sourcePad);
        if (sourceEffect) {
          const effectBytes = copyNodeWithPatchedInts(parsed.bytes, sourceEffect.node, [
            {
              field: sourceEffect.effectsIdxField,
              value: targetAbsoluteIndex
            }
          ]);
          const targetEffect = findPadEffectByIndex(parsed, targetAbsoluteIndex);

          if (targetEffect) {
            operations.push(replaceNodeOperation(targetEffect.node, effectBytes));
          } else {
            operations.push(
              appendChildNodeOperation(parsed.bytes, parsed.padEffectsNode, effectBytes)
            );
            operations.push(
              nodeCountOperation(parsed.padEffectsNode, parsed.padEffectsNode.count + 1)
            );
          }
        }
      } else if (targetPad && isEffectPad(targetPad)) {
        const targetEffect = findLinkedPadEffect(parsed, targetPad);
        if (targetEffect && canRemovePadEffect(parsed, targetEffect)) {
          operations.push(removeNodeOperation(parsed.bytes, targetEffect.node));
          operations.push(
            nodeCountOperation(parsed.padEffectsNode, parsed.padEffectsNode.count - 1)
          );
        }
      }
    }

    const newBytes = applyBinaryOperations(parsed.bytes, operations);
    const newParsed = parseShowConfig(newBytes);
    const candidates = newParsed.pads.filter(
      (pad) =>
        pad.absoluteIndex === targetAbsoluteIndex &&
        pad.triggerControl === targetAbsoluteIndex &&
        pad.rawType === sourcePad.rawType &&
        pad.name === sourcePad.name
    );
    const newPad =
      candidates[candidates.length - 1] ||
      newParsed.pads.find((pad) => pad.absoluteIndex === targetAbsoluteIndex) ||
      newParsed.pads[newParsed.pads.length - 1];

    return { parsed: newParsed, newPadId: newPad?.id ?? null };
  }

  globalObject.RodeShufflerParser = {
    analyzePadEffectsStructure,
    buildLayout,
    cleanOrphanPadEffects,
    duplicatePadBinary,
    encodeCString,
    exportRemappedBinary,
    findPadEffectsNode,
    formatPadFields,
    parseShowConfig,
    renamePadBinary,
    removePadBinary,
    resolveModel,
    padTypeIcon,
    updatePadEffectInputBinary
  };
})(window);
