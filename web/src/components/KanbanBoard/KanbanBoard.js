import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { STAGES } from '@demo/shared';
import styles from './KanbanBoard.module.scss';
export function KanbanBoard({ frames }) {
    return (_jsx("section", { className: styles.board, "aria-label": "render pipeline", children: STAGES.map((stage) => {
            const columnFrames = frames.filter((frame) => frame.stage === stage);
            return (_jsxs("div", { className: styles.column, children: [_jsxs("h2", { className: styles.columnTitle, children: [stage, " ", _jsx("span", { className: styles.count, children: columnFrames.length })] }), _jsx("ul", { className: styles.cards, children: columnFrames.map((frame) => (_jsxs("li", { className: `${styles.card} ${frame.priority ? styles.priority : ''}`, children: [_jsx("span", { children: frame.id }), frame.priority && (_jsx("span", { className: styles.badge, "aria-label": "high priority", children: "priority" })), frame.nodeId && _jsx("span", { className: styles.node, children: frame.nodeId }), frame.pct > 0 && frame.stage !== 'DONE' && (_jsx("span", { className: styles.bar, style: { width: `${frame.pct}%` }, "aria-hidden": "true" }))] }, frame.id))) })] }, stage));
        }) }));
}
