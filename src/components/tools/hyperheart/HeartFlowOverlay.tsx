import { flowElements, flowSymbols } from '../../../lib/tools/hyperheart/motion-data';
import { motionTransform, sampleMotion } from '../../../lib/tools/hyperheart/motion';
import { heartProjection } from '../../../lib/tools/hyperheart/source-mapping';

export default function HeartFlowOverlay({ sourceFrame }: { sourceFrame: number }) {
  return (
    <svg className="hh-animation-overlay hh-flow-overlay" viewBox="0 0 237 280" aria-hidden="true" focusable="false">
      <g transform={heartProjection}>
        {flowElements.map((element) => {
          const state = sampleMotion(element, sourceFrame);
          if (state._off || state.alpha <= 0) return null;
          const symbol = flowSymbols[element.symbol];
          return <g key={element.id} data-flow={element.id} transform={motionTransform(state)} opacity={state.alpha}>
            <path d={symbol.path} fill={symbol.fill} transform={`translate(${symbol.offset[0]} ${symbol.offset[1]})`} />
          </g>;
        })}
      </g>
    </svg>
  );
}
