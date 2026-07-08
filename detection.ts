// ============================================================================
// Bloxig — Structure-Based Interactivity Detection
// ============================================================================
// This is the core of how Bloxig decides WHICH elements in a converted UI are
// interactive — WITHOUT relying on layer names. It works on any design,
// regardless of how a user named their layers ("Btn_Dismiss", "collectReward",
// "Group 47", or another language entirely).
//
// The approach (heuristics find candidates → an AI infers the final role) mirrors
// how commercial design-to-code systems like Locofy operate, and is validated by
// UI-semantics research (e.g. Alibaba's view-hierarchy grouping). Bloxig applies
// it to Roblox / Luau — a platform none of those tools serve.
//
// Runs inside the Figma plugin on the exported node tree (true pixel geometry).
// Each detected node is stamped with { interactive, roleHint, uiContext }, which
// the Roblox plugin + the AI wiring layer (see routes/aiWire.js) then consume to
// generate the interaction code.
//
// NOTE: This is an excerpt showing the detection logic only. The full export
// engine (conversion, rasterization, scaling, image pipeline) lives in a private
// repository — this file intentionally contains none of it.
// ----------------------------------------------------------------------------
// Minimal shapes so this file reads standalone (the real types live in the
// plugin). A "node" is a Figma-style node: { type, name, width, height, fills,
// strokes, children, absoluteBoundingBox, characters, isRaster, imageName, ... }.

type UIContext = {
  text?: string;
  zoneX?: string;    // 'left' | 'center' | 'right'
  zoneY?: string;    // 'top' | 'middle' | 'bottom'
  aspect?: number;
  rowMember?: boolean;
};

// Container node types we consider as potential interactive wrappers.
const CONTAINER = ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION'];
function isContainer(node: any): boolean {
  return CONTAINER.indexOf(node.type) !== -1;
}

// Weak name fallback — used only as a tiebreaker, NEVER as the gate.
const INTERACTIVE_NAME_HINTS = ['button', 'btn', 'claim', 'close', 'exit', 'tab'];
function nameLooksLikeButton(name: string): boolean {
  const n = (name || '').toLowerCase();
  return INTERACTIVE_NAME_HINTS.some((h) => n.indexOf(h) !== -1);
}

// Input-ish name check (search fields, code entry, etc.).
function nameLooksLikeInput(name: string): boolean {
  const n = (name || '').toLowerCase();
  return ['input', 'search', 'field', 'entry', 'textbox'].some((h) => n.indexOf(h) !== -1);
}

// Name/prefix-based button check from the main engine (shown here as a stub —
// the real one also inspects layer prefixes). Used only as a weak booster.
function looksLikeButton(node: any, _parsed?: any): boolean {
  return nameLooksLikeButton(node.name || '');
}

// The id of the export root frame (never treated as interactive itself).
declare const __exportRootId: string | null;

// ════════════════════════════════════════════════════════════════════════

function isButtonCandidateByStructure(node: any): boolean {
  if (!isContainer(node)) return false;

  // Gate 1 — visual backing: the node OR a shallow descendant has a fill/stroke,
  // OR is a rasterized image (a baked PNG IS visual backing — e.g. a decorative
  // close button that got auto-rasterized has empty fills but a real rendered box).
  const nodeHasPaint = (nn: any): boolean => {
    if (nn.isRaster || nn.imageName) return true;   // baked image = backed
    const f = Array.isArray(nn.fills)   && nn.fills.some((x: any) => x && x.visible !== false);
    const s = Array.isArray(nn.strokes) && nn.strokes.length > 0;
    return !!(f || s);
  };
  const backingWithin = (nn: any, depth: number): boolean => {
    if (depth > 2) return false;
    if (nn.isRaster || nn.imageName) return true;             // raster anywhere = backed
    if (nn.type !== 'TEXT' && nodeHasPaint(nn)) return true;  // a non-text painted surface
    for (const c of (nn.children || [])) {
      if (backingWithin(c, depth + 1)) return true;
    }
    return false;
  };
  if (!backingWithin(node, 0)) return false;

  // Gate 2 — contains text (direct or shallow), but is NOT a multi-card grid.
  let cardFrames = 0, hasText = false;
  const textWithin = (nn: any, depth: number): boolean => {
    if (depth > 3) return false;
    if (nn.type === 'TEXT') return true;
    for (const c of (nn.children || [])) if (textWithin(c, depth + 1)) return true;
    return false;
  };
  for (const c of (node.children || [])) {
    if (c.visible === false) continue;
    if ((c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'INSTANCE')
        && (c.children || []).some((g: any) => g.type === 'TEXT')) cardFrames++;
  }
  hasText = textWithin(node, 0);
  if (cardFrames >= 2) return false;   // grid/list, not a single button

  // Gate 3 — physical scale sanity.
  const w = node.width || 0, h = node.height || 0;
  if (w <= 0 || h <= 0) return false;
  const area = w * h;
  if (area > 90000 && !nameLooksLikeButton(node.name || '')) return false; // ~300x300 banner guard
  const aspect = w / h;

  const isIconSized   = h >= 14 && h <= 90 && aspect >= 0.6 && aspect <= 1.7;   // square-ish (icon/close)
  const isButtonRatio = h >= 16 && h <= 110 && aspect >= 1.2 && aspect <= 7.0 && hasText;
  return isIconSized || isButtonRatio;
}

function inferRoleHint(node: any, ctx: { zoneX: string; zoneY: string; text: string; rowMember: boolean }): string {
  const t = (ctx.text || '').trim().toLowerCase();
  if (t === 'x' || t === '✕' || t === '×' || /\bclose\b|\bexit\b/.test(t)) return 'close';
  if (ctx.zoneY === 'top' && ctx.zoneX === 'right') {
    const w = node.width || 0, h = node.height || 0;
    const aspect = h > 0 ? w / h : 99;
    if (aspect >= 0.6 && aspect <= 1.7 && w <= 90) return 'close';
  }
  if (ctx.rowMember) return 'tab';
  if (/\b(claim|collect|redeem|get|buy|purchase|unlock|equip|use|start|play|confirm|open)\b/.test(t)) {
    return (t.includes('claim') || t.includes('collect') || t.includes('redeem')) ? 'claim' : 'action';
  }
  if (nameLooksLikeInput(node.name || '') || /\bsearch\b|\benter\b/.test(t)) return 'input';
  return 'generic';
}

function detectRowMembership(node: any, parent: any): boolean {
  if (!parent || !('children' in parent)) return false;
  const sibs = (parent.children || []).filter((c: any) =>
    c && c.visible !== false && (c.width || 0) > 0 && (c.height || 0) > 0
  );
  if (sibs.length < 2 || sibs.length > 8) return false;
  const gy = (c: any) => (c.absoluteBoundingBox ? c.absoluteBoundingBox.y : c.y) ?? 0;
  const gx = (c: any) => (c.absoluteBoundingBox ? c.absoluteBoundingBox.x : c.x) ?? 0;
  const baseY = gy(node), baseH = node.height || 0;
  const row = sibs.filter((c: any) => Math.abs(gy(c) - baseY) <= 6 && Math.abs((c.height || 0) - baseH) <= 6);
  if (row.length < 2) return false;
  row.sort((a: any, b: any) => gx(a) - gx(b));
  let expectedGap = -1;
  for (let i = 0; i < row.length - 1; i++) {
    const a = row[i], b = row[i + 1];
    const gap = gx(b) - (gx(a) + (a.width || 0));
    if (expectedGap < 0) expectedGap = gap;
    else if (Math.abs(gap - expectedGap) > 8) return false;
  }
  if (expectedGap > (row[0].width || 0) * 0.6) return false;  // spread = grid, not tabs
  return row.indexOf(node) !== -1;
}

function firstTextIn(node: any, depth: number = 0): string {
  if (!node || depth > 3) return '';
  if (node.type === 'TEXT' && typeof node.characters === 'string') return node.characters;
  for (const c of (node.children || [])) {
    const t = firstTextIn(c, depth + 1);
    if (t) return t;
  }
  return '';
}

// MAIN ENTRY: stamp base.interactive/roleHint/uiContext. absX/absY = this node's
// absolute origin; rootX/Y/W/H describe the export root frame for zone calc.
function detectInteractivity(
  node: any, base: any, parsed: ParsedName, parent: any,
  absX: number, absY: number,
  rootX: number, rootY: number, rootW: number, rootH: number
): boolean {
  if (node.id === __exportRootId) return false;
  if (node.type === 'TEXT') return false;   // loose text handled Roblox-side

  const nameSignal   = looksLikeButton(node, parsed) || nameLooksLikeButton(node.name || '');
  const structSignal = isButtonCandidateByStructure(node);
  if (!nameSignal && !structSignal) return false;

  const cx = absX + (node.width || 0) / 2;
  const cy = absY + (node.height || 0) / 2;
  const fracX = rootW > 0 ? (cx - rootX) / rootW : 0.5;
  const fracY = rootH > 0 ? (cy - rootY) / rootH : 0.5;
  const zoneX = fracX < 0.33 ? 'left' : (fracX > 0.66 ? 'right' : 'center');
  const zoneY = fracY < 0.25 ? 'top'  : (fracY > 0.72 ? 'bottom' : 'middle');
  const text  = firstTextIn(node).slice(0, 40);
  const rowMember = detectRowMembership(node, parent);
  const aspect = (node.height || 1) > 0 ? (node.width || 0) / (node.height || 1) : 0;

  base.interactive = true;
  base.roleHint = inferRoleHint(node, { zoneX, zoneY, text, rowMember });
  base.uiContext = {
    text: text || undefined,
    zoneX, zoneY,
    aspect: Math.round(aspect * 100) / 100,
    rowMember: rowMember || undefined,
  };
  return true;
}

