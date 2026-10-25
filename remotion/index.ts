// titik masuk Remotion CLI (render di laptop): npx remotion render remotion/index.ts StudioVideo out.mp4 --props=props.json
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
