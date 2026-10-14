#!/usr/bin/env python3
"""
capture_prototype.py

用途：
    对 HTML 交互原型的主要视图进行截图，用于 交互设计 Agent 内部 Review。
    截图不是默认正式用户交付物。

前提：
    Chrome / Chromium 已以 remote debugging 模式启动，例如：
    chromium --remote-debugging-port=9222

用法：
    python3 capture_prototype.py \
        --url "http://127.0.0.1:8000/prototype.html" \
        --out-dir ./review-screenshots \
        --views "home,detail,review"

说明：
    --views 中的名称会尝试匹配：
    1. 元素 id="<view>"
    2. [data-view="<view>"]
    3. [data-view-target="<view>"]
    4. [href="#<view>"]

    若不传 --views，则只截取当前视图。
"""

import argparse
import base64
import json
import os
import time
import urllib.parse
import urllib.request

try:
    import websocket
except ImportError as exc:
    raise SystemExit(
        "Missing dependency: websocket-client. "
        "Install with: pip install websocket-client"
    ) from exc


def list_tabs(debug_port):
    url = f"http://127.0.0.1:{debug_port}/json/list"
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read())


def find_tab(debug_port, url_keyword):
    for tab in list_tabs(debug_port):
        if url_keyword in tab.get("url", ""):
            return tab
    return None


def open_tab(debug_port, url):
    encoded = urllib.parse.quote(url, safe=":/?&=#%")
    endpoint = f"http://127.0.0.1:{debug_port}/json/new?{encoded}"
    req = urllib.request.Request(endpoint, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception:
        # Older Chrome versions may accept GET.
        try:
            urllib.request.urlopen(endpoint, timeout=5).read()
        except Exception:
            return False
    return True


def make_cdp(ws):
    msg_id = [0]

    def cdp(method, params=None, timeout=12):
        msg_id[0] += 1
        current_id = msg_id[0]
        payload = {"id": current_id, "method": method}
        if params:
            payload["params"] = params
        ws.send(json.dumps(payload))

        deadline = time.time() + timeout
        while time.time() < deadline:
            ws.settimeout(max(1, deadline - time.time()))
            try:
                response = json.loads(ws.recv())
            except Exception:
                break
            if response.get("id") == current_id:
                return response
        return {}

    return cdp


def js_eval(cdp, expression):
    result = cdp(
        "Runtime.evaluate",
        {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        },
    )
    return (
        result.get("result", {})
        .get("result", {})
        .get("value")
    )


def activate(cdp):
    cdp("Page.enable")
    cdp("Runtime.enable")
    cdp("Page.bringToFront")
    time.sleep(0.2)


def set_viewport(cdp, width, height, device_scale_factor=1):
    cdp(
        "Emulation.setDeviceMetricsOverride",
        {
            "width": width,
            "height": height,
            "deviceScaleFactor": device_scale_factor,
            "mobile": False,
        },
    )


def click(cdp, x, y):
    cdp(
        "Input.dispatchMouseEvent",
        {
            "type": "mousePressed",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        },
    )
    time.sleep(0.05)
    cdp(
        "Input.dispatchMouseEvent",
        {
            "type": "mouseReleased",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        },
    )


def click_view(cdp, view):
    escaped = json.dumps(view)
    expr = f"""
    (() => {{
      const view = {escaped};
      const selectors = [
        '#' + CSS.escape(view),
        '[data-view="' + CSS.escape(view) + '"]',
        '[data-view-target="' + CSS.escape(view) + '"]',
        '[href="#' + CSS.escape(view) + '"]'
      ];

      for (const selector of selectors) {{
        const el = document.querySelector(selector);
        if (!el) continue;
        el.scrollIntoView({{block: 'center', inline: 'center'}});
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        return JSON.stringify({{
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          selector
        }});
      }}
      return null;
    }})()
    """
    result = js_eval(cdp, expr)
    if not result:
        return False
    try:
        pos = json.loads(result)
        click(cdp, pos["x"], pos["y"])
        return True
    except Exception:
        return False


def scroll_for_render(cdp):
    js_eval(
        cdp,
        """
        (() => {
          window.scrollTo(0, 0);
          const h = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          );
          window.scrollTo(0, Math.min(h, window.innerHeight));
          window.scrollTo(0, 0);
          return h;
        })()
        """,
    )
    time.sleep(0.3)


def screenshot(cdp, path, full_page=False):
    params = {"format": "png", "fromSurface": True}

    if full_page:
        metrics = cdp("Page.getLayoutMetrics")
        content = metrics.get("result", {}).get("contentSize", {})
        width = max(1, int(content.get("width", 1)))
        height = max(1, int(content.get("height", 1)))
        params["clip"] = {
            "x": 0,
            "y": 0,
            "width": width,
            "height": height,
            "scale": 1,
        }
        params["captureBeyondViewport"] = True

    result = cdp("Page.captureScreenshot", params)
    data = result.get("result", {}).get("data")
    if not data:
        return False

    with open(path, "wb") as file:
        file.write(base64.b64decode(data))
    return True


def sanitize_filename(value):
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-") or "view"


def main():
    parser = argparse.ArgumentParser(
        description="Capture HTML prototype screenshots for internal UX review"
    )
    parser.add_argument("--url", required=True, help="Prototype URL")
    parser.add_argument("--out-dir", required=True, help="Screenshot output directory")
    parser.add_argument(
        "--views",
        help="Comma-separated view names to click before capture",
    )
    parser.add_argument(
        "--debug-port",
        type=int,
        default=9222,
        help="Chrome remote debugging port (default: 9222)",
    )
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=1000)
    parser.add_argument(
        "--wait",
        type=float,
        default=0.8,
        help="Wait time after view switch in seconds",
    )
    parser.add_argument(
        "--full-page",
        action="store_true",
        help="Capture the entire page instead of viewport only",
    )
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    tab = find_tab(args.debug_port, args.url)
    if not tab:
        print(f"Tab not found. Opening: {args.url}")
        open_tab(args.debug_port, args.url)
        time.sleep(1.5)
        tab = find_tab(args.debug_port, args.url)

    if not tab:
        raise SystemExit(
            "Could not find or open the prototype tab. "
            "Make sure Chrome remote debugging is running."
        )

    ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=15)
    cdp = make_cdp(ws)

    try:
        activate(cdp)
        set_viewport(cdp, args.width, args.height)
        time.sleep(args.wait)

        views = []
        if args.views:
            views = [v.strip() for v in args.views.split(",") if v.strip()]

        if not views:
            views = ["current"]

        for view in views:
            print(f"Capturing: {view}")

            if view != "current":
                clicked = click_view(cdp, view)
                if not clicked:
                    print(f"  Warning: could not locate navigation for view '{view}'")
                time.sleep(args.wait)

            scroll_for_render(cdp)

            filename = f"page-{sanitize_filename(view)}.png"
            out_path = os.path.join(args.out_dir, filename)
            ok = screenshot(cdp, out_path, full_page=args.full_page)

            if ok:
                print(f"  Saved: {out_path}")
            else:
                print(f"  Failed: {out_path}")

    finally:
        ws.close()


if __name__ == "__main__":
    import re
    main()
