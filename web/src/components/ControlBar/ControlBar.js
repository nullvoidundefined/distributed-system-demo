import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from './ControlBar.module.scss';
export function ControlBar({ onCommand, phase }) {
    const paused = phase === 'paused';
    return (_jsxs("div", { className: styles.bar, children: [_jsx("button", { type: "button", onClick: () => onCommand({ type: paused ? 'resume' : 'pause' }), children: paused ? 'Resume' : 'Pause' }), _jsx("button", { type: "button", onClick: () => onCommand({ type: 'inject', count: 5 }), children: "+ Inject 5" }), _jsx("button", { type: "button", onClick: () => onCommand({ type: 'killNode' }), children: "Kill a node" }), _jsx("button", { type: "button", onClick: () => onCommand({ type: 'reset' }), children: "Reset" })] }));
}
