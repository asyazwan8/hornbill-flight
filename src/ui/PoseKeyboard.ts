/**
 * An on-screen keyboard driven by a raised hand.
 *
 * The cursor follows the hand and a key is chosen by holding still over it —
 * dwelling — rather than by any clicking gesture. That is a deliberate trade.
 * MediaPipe's pose model tracks the body, not fingers: it gives a wrist and
 * three coarse points for the whole hand, which is nowhere near enough to tell
 * an open palm from a closed one at the distance this game is played from.
 * Reading a pinch out of those points would misfire constantly, and the second
 * model that could do it properly costs another download and another pass over
 * every frame on top of pose tracking and a 3D scene. A dwell needs none of
 * that and cannot be misread — the only way to select is to genuinely stop.
 */

/** How long the cursor must rest on a key before it is chosen. */
const DWELL_MS = 800;

/**
 * How far the cursor may drift while dwelling, as a fraction of a key.
 * Hands are never perfectly still, so demanding zero movement would mean
 * never selecting anything.
 */
const DWELL_SLACK = 0.9;

export type KeyPress =
  | { kind: "char"; value: string }
  | { kind: "delete" }
  | { kind: "post" }
  | { kind: "done" };

const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

export class PoseKeyboard {
  private keys: HTMLButtonElement[] = [];
  /**
   * Buttons outside the grid that the cursor can also settle on — POST and
   * DONE. Without these a player working the screen by hand could type a name
   * and then have no way to do anything with it.
   */
  private extras: HTMLElement[] = [];
  private dwellKey: HTMLElement | null = null;
  private dwellSince = 0;
  private dwellAt = { x: 0, y: 0 };
  /** Whether the cursor is live. Broader than the grid: the cursor stays up
   *  for POST and DONE after the letters have gone. */
  private active = false;

  /** Fired when a key has been dwelt on long enough to count. */
  onKey?: (key: KeyPress) => void;

  constructor(
    private root: HTMLElement,
    private cursor: HTMLElement,
    private cursorFill: HTMLElement
  ) {
    this.build();
  }

  private build() {
    const rows = document.createElement("div");
    rows.className = "key-rows";

    for (const row of ROWS) {
      const rowEl = document.createElement("div");
      rowEl.className = "key-row";
      for (const ch of row) rowEl.append(this.makeKey(ch, { kind: "char", value: ch }));
      rows.append(rowEl);
    }

    const last = document.createElement("div");
    last.className = "key-row";
    last.append(
      this.makeKey("SPACE", { kind: "char", value: " " }, "key-wide"),
      this.makeKey("DEL", { kind: "delete" }, "key-wide")
    );
    rows.append(last);

    this.root.append(rows);
  }

  private makeKey(label: string, press: KeyPress, extra = ""): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `key ${extra}`.trim();
    el.textContent = label;
    // Clickable too. The keyboard is on screen for the hand, but there is no
    // reason a mouse should be locked out of it.
    el.addEventListener("click", () => this.onKey?.(press));
    (el as HTMLButtonElement & { press: KeyPress }).press = press;
    this.keys.push(el);
    return el;
  }

  /** Register a button outside the grid as something the cursor can press. */
  addTarget(el: HTMLElement, press: KeyPress) {
    (el as HTMLElement & { press: KeyPress }).press = press;
    this.extras.push(el);
  }

  /** Turn the cursor on or off, independently of the letter grid. */
  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.cursor.classList.add("hidden");
      this.clearDwell();
    }
  }

  showKeys() {
    this.root.classList.remove("hidden");
  }

  hideKeys() {
    this.root.classList.add("hidden");
    this.clearDwell();
  }

  private clearDwell() {
    this.dwellKey?.classList.remove("dwelling");
    this.dwellKey = null;
    this.cursorFill.style.strokeDashoffset = "100";
  }

  /**
   * Move the cursor and advance the dwell. Called once per pose frame with a
   * 0..1 screen fraction, or null when no hand is raised.
   */
  setPointer(pointer: { x: number; y: number } | null) {
    if (!this.active) return;

    if (!pointer) {
      this.cursor.classList.add("hidden");
      this.clearDwell();
      return;
    }

    const x = pointer.x * window.innerWidth;
    const y = pointer.y * window.innerHeight;
    this.cursor.classList.remove("hidden");
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;

    const key = this.keyAt(x, y);
    if (!key) {
      this.clearDwell();
      return;
    }

    // Restart the dwell when the cursor moves to a different key, or drifts
    // too far within the one it is on.
    const box = key.getBoundingClientRect();
    const drifted =
      Math.abs(x - this.dwellAt.x) > box.width * DWELL_SLACK ||
      Math.abs(y - this.dwellAt.y) > box.height * DWELL_SLACK;

    if (key !== this.dwellKey || drifted) {
      this.clearDwell();
      this.dwellKey = key;
      this.dwellSince = performance.now();
      this.dwellAt = { x, y };
      key.classList.add("dwelling");
      return;
    }

    const progress = (performance.now() - this.dwellSince) / DWELL_MS;
    // The ring is a 100-unit dash, so the offset counts down as it fills.
    this.cursorFill.style.strokeDashoffset = String(Math.max(0, 100 - progress * 100));

    if (progress >= 1) {
      const press = (key as HTMLElement & { press: KeyPress }).press;
      this.clearDwell();
      // Park the dwell off any key so holding still does not immediately
      // repeat: the hand has to move away and come back.
      this.dwellKey = key;
      this.dwellSince = Number.POSITIVE_INFINITY;
      this.onKey?.(press);
    }
  }

  /**
   * Hit test in screen space, since that is where the cursor lives. Hidden
   * targets are skipped: `offsetParent` is null for anything inside a
   * `display: none` ancestor, which is how the letter grid and the name field
   * come and go.
   */
  private keyAt(x: number, y: number): HTMLElement | null {
    for (const key of [...this.keys, ...this.extras]) {
      if (key.offsetParent === null) continue;
      const b = key.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return key;
    }
    return null;
  }
}
