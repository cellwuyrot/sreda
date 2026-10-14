// No access/refresh token is ever stored in this browser script.
(() => {
  const element = (tag, text, parent) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  async function post(url, csrf, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, csrf }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Не удалось выполнить запрос");
    return data;
  }
  document.querySelectorAll(".qr-widget").forEach((widget) => {
    const button = widget.querySelector(".qr-start");
    const output = widget.querySelector(".qr-result");
    let timer;
    const stop = () => {
      clearTimeout(timer);
      button.disabled = false;
    };
    window.addEventListener("pagehide", stop, { once: true });
    button.addEventListener("click", async () => {
      stop();
      button.disabled = true;
      output.replaceChildren();
      try {
        const data = await post(widget.dataset.start, widget.dataset.csrf, {
          action: "start",
        });
        const image = element("div", "", output);
        image.className = "qr-image";
        image.innerHTML = data.svg;
        element(
          "p",
          `Код подтверждения: ${data.verificationCode}`,
          output,
        ).className = "verification-code";
        const status = element(
          "p",
          "Ожидаем подтверждения. QR действует 2 минуты.",
          output,
        );
        const poll = async () => {
          if (Date.now() >= new Date(data.expiresAt).getTime()) {
            status.textContent = "QR-код истёк. Создайте новый.";
            stop();
            return;
          }
          try {
            const result = await post(
              widget.dataset.start.endsWith("/start")
                ? widget.dataset.start.replace(/\/start$/, "/status")
                : widget.dataset.start,
              widget.dataset.csrf,
              { action: "status", id: data.id },
            );
            if (result.state === "approved") {
              stop();
              status.textContent = "Вход подтверждён…";
              const form = element("form", "", output);
              form.method = "post";
              form.action = widget.dataset.finish;
              for (const [name, value] of Object.entries({
                csrf: widget.dataset.csrf,
                action: "qr-finish",
                id: data.id,
              })) {
                const input = element("input", "", form);
                input.type = "hidden";
                input.name = name;
                input.value = value;
              }
              form.submit();
            } else if (result.state === "expired") {
              status.textContent =
                "Запрос отклонён или истёк. Создайте новый QR-код.";
              stop();
            } else timer = setTimeout(poll, 2000);
          } catch (error) {
            status.textContent = error.message;
            stop();
          }
        };
        timer = setTimeout(poll, 2000);
      } catch (error) {
        element("p", error.message, output);
        stop();
      }
    });
  });
  const approval = document.querySelector("#qr-approve");
  if (!approval) return;
  const output = approval.querySelector(".qr-result");
  const fragment = new URLSearchParams(location.hash.slice(1));
  let code = fragment.get("code");
  try {
    if (code) sessionStorage.setItem("tzid-qr-approval", code);
    else code = sessionStorage.getItem("tzid-qr-approval");
  } catch {
    /* Same-page approval still works without storage. */
  }
  history.replaceState(null, "", location.pathname);
  if (!code) {
    element("p", "Откройте QR-код с устройства, где требуется вход.", output);
    return;
  }
  if (approval.dataset.authenticated !== "true") {
    element(
      "p",
      "Сначала войдите в TZ ID на этом телефоне, затем вернитесь к подтверждению.",
      output,
    );
    return;
  }
  approval.querySelector("a").hidden = true;
  post("/api/portal/qr/inspect", approval.dataset.csrf, { code })
    .then((data) => {
      element("h2", data.project, output);
      element("p", data.domains.join(" · "), output);
      element(
        "p",
        `Код на другом устройстве должен быть: ${data.verificationCode}`,
        output,
      ).className = "verification-code";
      const label = element("label", "", output);
      label.className = "check";
      const agree = element("input", "", label);
      agree.type = "checkbox";
      label.append(
        document.createTextNode(
          " Я сам начал вход, название проекта и код совпадают",
        ),
      );
      const approve = element("button", "Подтвердить вход", output);
      approve.disabled = true;
      const deny = element("button", "Отклонить", output);
      deny.className = "secondary";
      agree.addEventListener("change", () => {
        approve.disabled = !agree.checked;
      });
      for (const [button, rejected] of [
        [approve, false],
        [deny, true],
      ])
        button.addEventListener("click", async () => {
          approve.disabled = true;
          deny.disabled = true;
          try {
            await post("/api/portal/qr/approve", approval.dataset.csrf, {
              code,
              verificationCode: data.verificationCode,
              deny: rejected,
            });
            try {
              sessionStorage.removeItem("tzid-qr-approval");
            } catch {
              /* No stored credential. */
            }
            output.replaceChildren();
            element(
              "p",
              rejected
                ? "Вход отклонён."
                : "Вход подтверждён. Продолжите на другом устройстве.",
              output,
            );
          } catch (error) {
            element("p", error.message, output);
            deny.disabled = false;
            approve.disabled = !agree.checked;
          }
        });
    })
    .catch((error) => {
      element("p", error.message, output);
    });
})();
