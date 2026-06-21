#!/usr/bin/env python3
"""
Infra Design — sidecar geometrii (ezdxf / Shapely / A*).

Protokół: newline-delimited JSON przez stdio.
    request : {"id": int, "method": str, "params": dict}\n   (stdin)
    response: {"id": int, "ok": true, "result": any}\n         (stdout)
            | {"id": int, "ok": false, "error": str}\n          (stdout)

stdout jest zarezerwowany WYŁĄCZNIE dla protokołu (jeden JSON na linię).
Diagnostyka idzie na stderr.

F0 obsługuje tylko `ping` (handshake — zwraca wersję ezdxf).
Kolejne metody (import_dxf, polygonize, route, export) dochodzą w F1+.
"""

import json
import sys
import platform


def _ezdxf_version() -> str:
    try:
        import ezdxf  # type: ignore
        return getattr(ezdxf, "__version__", "unknown")
    except Exception as exc:  # noqa: BLE001
        return f"missing ({exc.__class__.__name__})"


HANDLERS = {}


def handler(name):
    def deco(fn):
        HANDLERS[name] = fn
        return fn
    return deco


@handler("ping")
def _ping(_params):
    return {
        "pong": True,
        "ezdxf": _ezdxf_version(),
        "python": platform.python_version(),
    }


def dispatch(method: str, params: dict):
    fn = HANDLERS.get(method)
    if fn is None:
        raise ValueError(f"Nieznana metoda: {method}")
    return fn(params or {})


def main() -> int:
    print("infra-design sidecar gotowy", file=sys.stderr, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            msg_id = msg.get("id")
            result = dispatch(msg.get("method", ""), msg.get("params"))
            out = {"id": msg_id, "ok": True, "result": result}
        except Exception as exc:  # noqa: BLE001
            out = {
                "id": locals().get("msg_id"),
                "ok": False,
                "error": f"{exc.__class__.__name__}: {exc}",
            }
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
