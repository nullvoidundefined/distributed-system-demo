import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Root layout: header with live stats and controls, Kanban board, worker-node strip, event log. */
import { ControlBar } from './components/ControlBar/ControlBar.js';
import { EventLog } from './components/EventLog/EventLog.js';
import { KanbanBoard } from './components/KanbanBoard/KanbanBoard.js';
import { NodeStrip } from './components/NodeStrip/NodeStrip.js';
import { useCommands } from './state/useCommands.js';
import { useWorldState } from './state/useWorldState.js';
import styles from './App.module.scss';
export function App() {
    const world = useWorldState();
    const send = useCommands();
    return (_jsxs("main", { className: styles.app, children: [_jsxs("header", { className: styles.header, children: [_jsxs("h1", { className: styles.title, children: ["Render Farm ", _jsx("span", { className: styles.dim, children: "distributed demo" })] }), _jsxs("p", { className: styles.stats, children: ["Cycle #", world.cycle, " \u00B7 ", world.totals.done, "/", world.totals.total, " frames \u00B7", ' ', world.nodes.length, " nodes \u00B7 ", world.phase] }), _jsx(ControlBar, { phase: world.phase, onCommand: send })] }), _jsx(KanbanBoard, { frames: world.frames }), _jsx(NodeStrip, { nodes: world.nodes }), _jsx(EventLog, { events: world.events })] }));
}
