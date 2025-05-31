import { JigsawStack } from "jigsawstack";

export class JigsawProvider {
  private static instance: JigsawProvider;
  public jigsawInstance: ReturnType<typeof JigsawStack>;

  private constructor({ apiKey }: { apiKey?: string }) {
    this.jigsawInstance = JigsawStack({
      apiKey: apiKey || process.env.JIGSAW_API_KEY,
    });
  }

  public static getInstance({ apiKey }: { apiKey?: string }): JigsawProvider {
    if (!JigsawProvider.instance) {
      JigsawProvider.instance = new JigsawProvider({ apiKey });
    }
    return JigsawProvider.instance;
  }
}
