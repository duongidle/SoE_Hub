import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const run = promisify(execFile);

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 375, height: 812 },
} as const;
export type ProjectName = keyof typeof VIEWPORTS;

export const WEB = process.env.E2E_WEB_URL ?? "http://localhost:5273";
export const API = process.env.E2E_API_URL ?? "http://localhost:3100";
const SHOTS = path.join(process.cwd(), "e2e", "screenshots");

/** One signed-in (or anonymous) browser of one person. Collects console errors and failed network requests. */
export class Session {
  problems: string[] = [];
  private allowed: { status: number; url: RegExp }[] = [{ status: 401, url: /\/api\/v1\/auth\/me$/ }];

  private constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly project: ProjectName,
    readonly name: string,
  ) {
    page.on("dialog", (d) => void d.accept());
    page.on("pageerror", (e) => this.problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      // HTTP failures are judged through the response listener below (so expected 401/403 can be allowed).
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) this.problems.push(`console.error: ${m.text()}`);
    });
    page.on("requestfailed", (r) => {
      // The live-update stream, and any GET still running when the page navigates, are cancelled by the browser itself.
      if (/\/api\/v1\/events/.test(r.url()) || (r.method() === "GET" && /ERR_ABORTED/.test(r.failure()?.errorText ?? ""))) return;
      this.problems.push(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`);
    });
    page.on("response", (r) => {
      if (r.status() < 400) return;
      if (this.allowed.some((a) => a.status === r.status() && a.url.test(r.url()))) return;
      this.problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()} (trang: ${page.url().replace(WEB, "")})`);
    });
  }

  static async open(browser: Browser, project: ProjectName, name: string): Promise<Session> {
    const context = await browser.newContext({
      baseURL: WEB,
      viewport: VIEWPORTS[project],
      isMobile: project === "phone",
      hasTouch: project === "phone",
      deviceScaleFactor: project === "phone" ? 2 : 1,
    });
    return new Session(context, await context.newPage(), project, name);
  }

  /** Allow an expected HTTP error (for example a 401 for a wrong password) in this session. */
  allow(status: number, url: RegExp): this {
    this.allowed.push({ status, url });
    return this;
  }

  /** Fails when the session saw an unexpected console error or a failed/4xx/5xx request since the last check. */
  check(): void {
    const found = this.problems;
    this.problems = [];
    expect(found, `Lỗi console/network ở phiên "${this.name}"`).toEqual([]);
  }

  /** The page itself must never scroll sideways (wide tables scroll inside their own box). */
  async expectNoHorizontalOverflow(): Promise<void> {
    const o = await this.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(o.scroll, `Trang tràn ngang: scrollWidth ${o.scroll} > ${o.width} (${this.page.url()})`).toBeLessThanOrEqual(o.width);
  }

  async shot(label: string): Promise<void> {
    if (!label.startsWith("FAILED")) await this.expectNoHorizontalOverflow();
    await this.page.screenshot({ path: path.join(SHOTS, `${this.project}-${label}.png`), fullPage: true });
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  private get burger() {
    return this.page.getByRole("button", { name: "Mở menu" });
  }

  private async menuNav() {
    if (await this.burger.isVisible()) {
      if ((await this.burger.getAttribute("aria-expanded")) !== "true") await this.burger.click();
      return this.page.getByRole("navigation", { name: "Menu điện thoại" });
    }
    return this.page.getByRole("navigation", { name: "Menu chính" });
  }

  async menuLink(label: string) {
    return (await this.menuNav()).getByRole("link", { name: label, exact: true });
  }

  async clickMenu(label: string): Promise<void> {
    await (await this.menuLink(label)).click();
  }

  async hasMenu(label: string): Promise<boolean> {
    return (await (await this.menuLink(label)).count()) > 0;
  }

  async bellCount(): Promise<number> {
    const l = this.page.getByTestId("bell-count");
    return (await l.count()) ? Number(await l.textContent()) : 0;
  }

  async login(email: string, password: string, next?: string): Promise<void> {
    await this.page.goto(next ? `/dang-nhap?next=${encodeURIComponent(next)}` : "/dang-nhap");
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Mật khẩu").fill(password);
    await this.page.getByRole("button", { name: "Đăng nhập" }).click();
  }

  async logout(): Promise<void> {
    await this.page.getByRole("button", { name: "Đăng xuất" }).click();
    await expect(this.page).toHaveURL(/\/dang-nhap/);
  }

  /** Step 1 of registration or password reset: ask for a code. */
  async requestCode(purpose: "activate" | "reset", email: string): Promise<void> {
    await this.page.goto(purpose === "activate" ? "/dang-ky" : "/quen-mat-khau");
    await this.page.getByLabel("Email công ty").fill(email);
    await this.page.getByRole("button", { name: "Xin mã" }).click();
    await expect(this.page.getByText("Đã gửi yêu cầu.")).toBeVisible();
  }

  /** Step 2: enter the code and the new password (the page is already on the code step after requestCode). */
  async submitCode(purpose: "activate" | "reset", code: string, password: string): Promise<void> {
    await this.page.getByLabel("Mã 6 số").fill(code);
    await this.page.getByLabel(purpose === "activate" ? "Đặt mật khẩu" : "Mật khẩu mới").fill(password);
    await this.page.getByLabel("Nhập lại mật khẩu").fill(password);
    await this.page.getByRole("button", { name: purpose === "activate" ? "Kích hoạt và đăng nhập" : "Đặt lại mật khẩu" }).click();
    await expect(this.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }

  private seenCodes = new Set<string>();

  /**
   * Opens the inbox and returns the newest code in a notification that mentions `email`, never one this session
   * already returned (a new request may take a moment to arrive; the page is reloaded until it does).
   */
  async readCode(email: string): Promise<string> {
    let found = "";
    await expect
      .poll(
        async () => {
          await this.page.goto("/thong-bao");
          const card = this.page.locator("div.rounded-lg", { hasText: email }).filter({ has: this.page.locator(".font-mono") }).first();
          if (!(await card.isVisible())) return "";
          found = ((await card.locator(".font-mono").first().textContent()) ?? "").trim();
          return this.seenCodes.has(found) ? "" : found;
        },
        { message: `Mã của ${email} chưa về hộp thông báo`, timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toMatch(/^\d{6}$/);
    this.seenCodes.add(found);
    return found;
  }

  /** Org chart form: adds one person. */
  async addMember(m: { email: string; name: string; role: "Manager" | "Leader" | "User"; manager?: string; leader?: string }): Promise<void> {
    await this.page.goto("/to-chuc");
    await this.page.getByRole("button", { name: "Thêm người" }).click();
    const d = this.page.getByRole("dialog", { name: "Thêm người vào org chart" });
    await d.getByLabel("Email").fill(m.email);
    await d.getByLabel("Họ tên").fill(m.name);
    if (m.role !== "User") {
      await d.getByRole("checkbox", { name: m.role, exact: true }).check();
      await d.getByRole("checkbox", { name: "User", exact: true }).uncheck();
    }
    if (m.manager) await d.getByLabel("Thuộc cây của Manager").selectOption({ label: m.manager });
    if (m.leader) await d.getByLabel("Cấp trên trực tiếp").selectOption({ label: m.leader });
    await d.getByRole("button", { name: "Lưu" }).click();
    await expect(d).toBeHidden();
    await expect(this.page.getByRole("row", { name: new RegExp(m.email) })).toBeVisible();
  }
}

/** The CLI command of the design (module1 6.6), run against the e2e database. Returns the activation code. */
export async function cliAdminCreate(email: string, name: string): Promise<string> {
  const { stdout } = await run("pnpm", ["cli", "admin:create", "--email", email, "--name", name], { cwd: path.join(process.cwd(), "../.."), env: process.env });
  const m = /Mã kích hoạt: (\d{6})/.exec(stdout);
  if (!m) throw new Error(`Không đọc được mã từ lệnh admin:create:\n${stdout}`);
  return m[1]!;
}
