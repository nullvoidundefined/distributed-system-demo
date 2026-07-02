import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from './NodeStrip.module.scss';
export function NodeStrip({ nodes }) {
    return (_jsx("section", { className: styles.strip, "aria-label": "worker nodes", children: nodes.map((node) => (_jsxs("article", { className: `${styles.node} ${styles[node.state] ?? ''}`, children: [_jsxs("header", { className: styles.head, children: [_jsx("strong", { children: node.id }), _jsxs("span", { className: styles.pid, children: ["pid ", node.pid] })] }), _jsx("div", { className: styles.state, children: node.state }), _jsx("div", { className: styles.frame, children: node.frameId ?? 'idle' }), _jsx("div", { className: styles.track, children: _jsx("span", { className: styles.fill, style: { width: `${node.pct}%` }, "aria-hidden": "true" }) }), _jsxs("footer", { className: styles.done, children: [node.completed, " done"] })] }, node.id))) }));
}
