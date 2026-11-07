export default class MockGraphic extends HTMLElement {
  async load(params) {
    this.loadParams = params;
    if (params.data.failLoad) throw new Error('Fixture load failed');
    return { statusCode: 200 };
  }

  playAction() {
    return new Promise((resolve) => {
      this.finishPlay = () => resolve({ statusCode: 200, currentStep: 0 });
    });
  }

  async stopAction() {
    this.finishPlay?.();
    return { statusCode: 200 };
  }

  async updateAction() {
    return { statusCode: 200 };
  }

  async customAction() {
    return { statusCode: 200 };
  }

  async dispose() {
    this.disposeCount = (this.disposeCount ?? 0) + 1;
    return { statusCode: 200 };
  }
}
