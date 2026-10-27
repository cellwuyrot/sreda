import React from "react";
import { createRoot } from "react-dom/client";
import ModalBackdrop from "../../../apps/web/src/components/connect/ModalBackdrop";
import FullscreenButton from "../../../apps/web/src/components/voice/FullscreenButton";
import { ensureVoiceReceiver } from "../../../apps/web/src/lib/voiceMicrophone";
(window as any).ensureVoiceReceiver = ensureVoiceReceiver;
createRoot(document.getElementById("root")!).render(<div>
<div data-fullscreen-target id="surface" style={{background:"black",color:"white",width:300,height:200}}><FullscreenButton /></div>
<ModalBackdrop onClose={() => {}}><button>Канал</button><input aria-label="Название" autoFocus /></ModalBackdrop>
</div>);

import * as e2ee from "../../../apps/web/src/lib/e2ee";
(window as any).e2ee = e2ee;
