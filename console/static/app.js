import { API, FIELD_LABELS } from "./api.js";

const main = document.querySelector("#main");
const identity = document.querySelector("#identity");
let api;
let controller;
const previews = new Set();
const element = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on"))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") node.className = value;
    else if (value !== false && value != null)
      node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children.filter((c) => c != null));
  return node;
};
const button = (label, action, className = "primary") =>
  element(
    "button",
    { type: "button", class: className, onClick: action },
    label,
  );
const text = (content, className = "") =>
  element("p", { class: className }, content);
const heading = (title, description) =>
  element(
    "div",
    { class: "page-heading" },
    text("DOCUMENT INTELLIGENCE", "eyebrow"),
    element("h1", {}, title),
    text(description, "muted"),
  );
const statusLabel = (status) =>
  ({
    unverified: "Unverified OCR",
    confirmed: "Confirmed by operator",
    processing: "Processing",
    failed: "Extraction failed",
  })[status];
const badge = (status) =>
  element("span", { class: `badge ${status}` }, statusLabel(status));
const date = (value) =>
  Number.isNaN(Date.parse(value))
    ? "Time not reported"
    : new Date(value).toLocaleString();
function clearPreviews() {
  for (const url of previews) URL.revokeObjectURL(url);
  previews.clear();
  for (const input of main.querySelectorAll("input")) {
    input.value = "";
    input.removeAttribute("value");
  }
}
function showError(container, error, retry) {
  container.replaceChildren(
    element(
      "div",
      { role: "alert", class: "error" },
      text(error.message),
      retry ? button("Try again", retry, "secondary") : null,
    ),
  );
  if (api && !api.context)
    identity.textContent = "Operator context unavailable";
}
function loading() {
  main.replaceChildren(text("Loading from Document Intelligence…", "loading"));
}
function scanPage(signal) {
  main.replaceChildren(
    heading(
      "Scan document",
      "Extract the fields. Check the evidence. Confirm with confidence.",
    ),
  );
  const errors = element("div");
  const form = element("form", { autocomplete: "off" });
  const uploads = element("div", { class: "upload-grid" });
  for (const [side, label] of [
    ["front", "Front"],
    ["back", "Back"],
  ]) {
    const preview = element(
      "div",
      { class: "preview" },
      element("span", { "aria-hidden": true, class: "document-icon" }, "▤"),
      text(`${label} of document`, "muted"),
    );
    const input = element("input", {
      type: "file",
      id: side,
      name: side,
      accept: "image/jpeg,image/png,image/webp",
      required: side === "front",
    });
    let objectURL;
    input.addEventListener("change", () => {
      if (objectURL) {
        URL.revokeObjectURL(objectURL);
        previews.delete(objectURL);
      }
      preview.replaceChildren(text(`${label} of document`, "muted"));
      errors.replaceChildren();
      const file = input.files[0];
      if (!file) return;
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024 ||
        !file.size
      ) {
        input.value = "";
        showError(
          errors,
          new Error(
            "Choose a non-empty JPG, PNG, or WebP image, up to 10 MB per side.",
          ),
        );
        return;
      }
      objectURL = URL.createObjectURL(file);
      previews.add(objectURL);
      preview.replaceChildren(
        element("img", { src: objectURL, alt: `${label} image preview` }),
      );
    });
    uploads.append(
      element(
        "section",
        { class: "card upload-card" },
        element("label", { for: side }, `${label} image`),
        text(
          side === "front"
            ? "Required · Keep all edges visible"
            : "Optional · Add if your document has a back",
          "muted small",
        ),
        preview,
        input,
      ),
    );
  }
  const submit = element(
    "button",
    { class: "primary", type: "submit" },
    "Extract fields",
  );
  form.append(
    uploads,
    element(
      "div",
      { class: "action-row" },
      text("JPG, PNG, WebP · Up to 10 MB per side", "muted small"),
      submit,
    ),
    errors,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const data = new FormData(form);
    if (!data.get("back")?.size) data.delete("back");
    submit.disabled = true;
    submit.textContent = "Extracting…";
    errors.replaceChildren();
    try {
      const scan = await api.upload(data, signal);
      if (signal.aborted) return;
      clearPreviews();
      history.replaceState(null, "", `#detail/${encodeURIComponent(scan.id)}`);
      detailPage(scan, signal);
    } catch (error) {
      if (!signal.aborted) showError(errors, error);
    } finally {
      data.delete("front");
      data.delete("back");
      submit.disabled = false;
      submit.textContent = "Extract fields";
    }
  });
  main.append(
    form,
    element(
      "div",
      { class: "notice" },
      element("strong", {}, "Always verify the original."),
      text(
        "OCR results are unverified until you confirm them. Images go directly to the Document Intelligence API; this console does not store them.",
      ),
    ),
  );
}
function detailPage(scan, signal) {
  main.replaceChildren(
    heading(
      scan.status === "unverified" ? "Review extracted fields" : "Scan detail",
      `Scan ${scan.id} · ${date(scan.created_at)}`,
    ),
  );
  main.append(
    element(
      "div",
      { class: "summary-line" },
      badge(scan.status),
      element("a", { href: "#recent" }, "Back to recent scans"),
    ),
  );
  if (["processing", "failed"].includes(scan.status)) {
    main.append(
      element(
        "section",
        { class: "card" },
        text(
          scan.status === "processing"
            ? "The API is still extracting fields. Refresh to check progress."
            : "Extraction could not be completed. Upload a new scan or contact your administrator.",
        ),
        button("Refresh scan", route, "secondary"),
      ),
    );
    return;
  }
  const confirmed = scan.status === "confirmed";
  main.append(
    element(
      "div",
      { class: confirmed ? "notice success" : "notice warning" },
      text(
        confirmed
          ? "Review complete. Document number is masked. Evidence is hidden after confirmation to protect document data."
          : "Unverified OCR — check every field against the original document before confirming.",
      ),
    ),
  );
  if (scan.warnings.length)
    main.append(
      element(
        "ul",
        { class: "warnings" },
        ...scan.warnings.map((w) => element("li", {}, w)),
      ),
    );
  const form = element("form", {
    autocomplete: "off",
    class: "card review-card",
  });
  const grid = element("div", { class: "field-grid" });
  for (const [key, field] of Object.entries(scan.fields)) {
    const label = element("label", { for: `field-${key}` }, FIELD_LABELS[key]);
    const value = confirmed
      ? element("p", { class: "field-value" }, field.value || "Not extracted")
      : element("input", {
          id: `field-${key}`,
          name: key,
          type: "text",
          value: field.value,
          autocomplete: "off",
          spellcheck: "false",
          maxlength: "1000",
        });
    const confidence =
      field.confidence == null
        ? null
        : text(
            `${Math.round(field.confidence * 100)}% OCR confidence`,
            "small muted",
          );
    grid.append(
      element(
        "div",
        { class: "field" },
        label,
        value,
        confirmed ? null : confidence,
        field.evidence ? text(`Evidence: ${field.evidence}`, "evidence") : null,
        ...field.warnings.map((w) => text(w, "field-warning")),
      ),
    );
  }
  form.append(grid);
  const errors = element("div");
  if (!confirmed) {
    const acknowledgement = element("input", {
      type: "checkbox",
      id: "acknowledge",
    });
    const submit = element(
      "button",
      { type: "submit", class: "primary", disabled: true },
      "Confirm fields",
    );
    acknowledgement.addEventListener("change", () => {
      submit.disabled = !acknowledgement.checked;
    });
    form.addEventListener("input", (event) => {
      if (event.target !== acknowledgement) {
        acknowledgement.checked = false;
        submit.disabled = true;
      }
    });
    form.append(
      element(
        "label",
        { class: "acknowledgement", for: "acknowledge" },
        acknowledgement,
        "I have checked these fields against the document",
      ),
      element(
        "div",
        { class: "action-row" },
        button("Reload scan", route, "secondary"),
        submit,
      ),
      errors,
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!acknowledgement.checked || submit.disabled) return;
      const fields = Object.fromEntries(
        Object.keys(scan.fields).map((key) => [
          key,
          form.elements.namedItem(key).value,
        ]),
      );
      submit.disabled = true;
      acknowledgement.disabled = true;
      submit.textContent = "Confirming…";
      errors.replaceChildren();
      for (const input of form.querySelectorAll("input[type=text]"))
        input.readOnly = true;
      try {
        const result = await api.confirm(scan, fields, signal);
        if (signal.aborted) return;
        clearPreviews();
        // Release the unverified record and wipe the detached form immediately.
        for (const f of Object.values(scan.fields)) {
          f.value = "";
          f.evidence = "";
          f.warnings = [];
        }
        scan = result;
        detailPage(result, signal);
      } catch (error) {
        if (!signal.aborted) showError(errors, error);
      } finally {
        for (const key of Object.keys(fields)) fields[key] = "";
        acknowledgement.disabled = false;
        submit.disabled = !acknowledgement.checked;
        submit.textContent = "Confirm fields";
        for (const input of form.querySelectorAll("input[type=text]"))
          input.readOnly = false;
      }
    });
  }
  main.append(form);
  if (scan.authority)
    main.append(
      element(
        "section",
        { class: "card authority" },
        element(
          "div",
          {},
          element("h2", {}, "Authority reference"),
          text(
            "The API has allowlisted this QR destination. Opens only when you choose to visit it.",
            "muted",
          ),
        ),
        element(
          "a",
          {
            href: scan.authority,
            target: "_blank",
            rel: "noopener noreferrer",
            referrerpolicy: "no-referrer",
            class: "button secondary",
          },
          "Open authority website",
        ),
      ),
    );
}
async function recentPage(signal) {
  main.replaceChildren(
    heading(
      "Recent scans",
      "Scans visible to your authenticated tenant and operator context.",
    ),
  );
  const list = element("div", { class: "scan-list" });
  const errors = element("div");
  let cursor = null;
  const seen = new Set();
  const more = button("Load more", load, "secondary");
  more.hidden = true;
  main.append(list, errors, more);
  async function load() {
    more.disabled = true;
    errors.replaceChildren();
    try {
      const data = await api.recent(cursor, signal);
      if (signal.aborted) return;
      if (!data.items.length && !seen.size)
        list.append(
          element(
            "section",
            { class: "card empty" },
            element("h2", {}, "No scans yet"),
            text("Start with a document to build your review history."),
            element(
              "a",
              { href: "#scan", class: "button primary" },
              "Scan a document",
            ),
          ),
        );
      for (const scan of data.items) {
        if (seen.has(scan.id)) continue;
        seen.add(scan.id);
        list.append(
          element(
            "article",
            { class: "card scan-row" },
            element(
              "div",
              {},
              element("h2", {}, scan.id),
              text(date(scan.created_at), "small muted"),
            ),
            badge(scan.status),
            element(
              "a",
              {
                href: `#detail/${encodeURIComponent(scan.id)}`,
                "aria-label": `View ${scan.id}`,
              },
              "View scan →",
            ),
          ),
        );
      }
      more.hidden = !data.next || data.next === cursor;
      cursor = data.next;
    } catch (error) {
      if (!signal.aborted) showError(errors, error, load);
    } finally {
      more.disabled = false;
    }
  }
  await load();
}
async function systemPage(signal) {
  main.replaceChildren(
    heading(
      "Health & system",
      "Service visibility for your operator workspace.",
    ),
  );
  main.append(
    element(
      "section",
      { class: "card" },
      element("h2", {}, "Console available"),
      text(
        "Static host is responding. API availability is checked separately.",
        "muted",
      ),
      text(`API base: ${api.base || "/"}`, "mono"),
    ),
  );
  const status = element("section", { class: "card" }, text("Checking API…"));
  main.append(status);
  try {
    const health = await api.health(signal);
    if (signal.aborted) return;
    status.replaceChildren(
      element(
        "h2",
        {},
        health.status === "ok" ? "API available" : `API ${health.status}`,
      ),
      text(`Version: ${health.version}`, "muted"),
      button("Refresh health", route, "secondary"),
    );
  } catch (error) {
    if (!signal.aborted) showError(status, error, route);
  }
  if (signal.aborted) return;
  main.append(
    element(
      "section",
      { class: "card" },
      element("h2", {}, "Data handling"),
      text(
        "Authentication and tenant permissions are managed by the API and ingress. Identity values are opaque. This console has no user database, document storage, or biometric processing.",
      ),
    ),
  );
}
async function route() {
  controller?.abort();
  clearPreviews();
  controller = new AbortController();
  const signal = controller.signal;
  const path = location.hash.slice(1) || "scan";
  document.querySelectorAll("nav a").forEach((a) => {
    if (a.hash === `#${path}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  loading();
  try {
    if (!api) {
      const response = await fetch("/config", {
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok)
        throw new Error("Console configuration is unavailable. Try again.");
      const config = await response.json();
      if (typeof config.apiBaseUrl !== "string")
        throw new Error("Console configuration is invalid.");
      api = new API(config.apiBaseUrl);
    }
    if (path === "system") return await systemPage(signal);
    if (!api.context) {
      const context = await api.identity(signal);
      if (signal.aborted) return;
      identity.replaceChildren(
        element(
          "span",
          {},
          "Tenant ",
          element("strong", {}, context.tenant_id),
        ),
        element(
          "span",
          {},
          "Operator ",
          element("strong", {}, context.operator_id),
        ),
      );
    }
    if (signal.aborted) return;
    if (path === "recent") return await recentPage(signal);
    if (/^detail\/[A-Za-z0-9_-]{1,128}$/.test(path)) {
      const scan = await api.scan(path.slice(7), signal);
      if (!signal.aborted) detailPage(scan, signal);
    } else if (path === "scan" || path === "main") scanPage(signal);
    else
      main.replaceChildren(
        heading("Page not found", "Choose a page from the navigation."),
      );
  } catch (error) {
    if (!signal.aborted) showError(main, error, route);
  }
}
document.querySelector(".skip").addEventListener("click", (event) => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: "start" });
});
window.addEventListener("hashchange", route);
window.addEventListener("pagehide", () => {
  controller?.abort();
  clearPreviews();
  main.replaceChildren();
  if (api) api.context = null;
  identity.textContent = "";
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) route();
});
route();
