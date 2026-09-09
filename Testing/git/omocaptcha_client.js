import axios from "axios";

/**
 * OMOCaptcha Client hỗ trợ giải Captcha tự động
 * Document: https://docs.omocaptcha.com
 */
export class OMOCaptchaClient {
  constructor(apiKey = null) {
    this._apiKey = apiKey || process.env.OMOCAPTCHA_KEY || "OMO_ZXBIKLLYNRYNT3MYF9XGRBJ5H1ZTJVOVNJCXTTZLWXL10PSID7X9PMZRGOJXTM1781149616";
    this._baseUrl = "https://api.omocaptcha.com/v2";
  }

  get apiKey() {
    return this._apiKey;
  }

  setApiKey(key) {
    this._apiKey = key;
  }

  /**
   * Kiểm tra số dư tài khoản
   * @returns {Promise<number|null>} Số dư (USD)
   */
  async getBalance() {
    if (!this._apiKey) return null;
    try {
      const resp = await axios.post(`${this._baseUrl}/getBalance`, {
        clientKey: this._apiKey,
      }, { timeout: 8000 });

      if (resp.data?.errorId === 0 && resp.data?.balance !== undefined) {
        return Number(resp.data.balance);
      }
      console.warn(`[OMOCaptcha] Lỗi getBalance: ${resp.data?.errorDescription || JSON.stringify(resp.data)}`);
      return null;
    } catch (err) {
      console.warn(`[OMOCaptcha] Lỗi kết nối getBalance: ${err.message}`);
      return null;
    }
  }

  /**
   * Tạo task giải Slider (SliderAllWebTask)
   * @param {string} imageBase64 Chuỗi Base64 của ảnh nền (có lỗ ghép)
   * @param {number} widthView Chiều rộng hiển thị thực tế trên web (px)
   * @param {number} [heightView] Chiều cao hiển thị thực tế trên web (px)
   * @returns {Promise<string|null>} taskId
   */
  async createSliderTask(imageBase64, widthView, heightView = null) {
    if (!this._apiKey) throw new Error("OMOCaptcha API Key chưa được cấu hình.");

    // Làm sạch chuỗi Base64 nếu có data URI prefix
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    const payload = {
      clientKey: this._apiKey,
      task: {
        type: "SliderAllWebTask",
        imageBase64: cleanBase64,
        widthView: Math.round(widthView),
      },
    };

    if (heightView) {
      payload.task.heightView = Math.round(heightView);
    }

    try {
      const resp = await axios.post(`${this._baseUrl}/createTask`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      if (resp.data?.errorId === 0 && resp.data?.taskId) {
        return resp.data.taskId;
      }
      console.warn(`[OMOCaptcha] Không thể tạo Slider Task: ${resp.data?.errorDescription || resp.data?.errorCode || JSON.stringify(resp.data)}`);
      return null;
    } catch (err) {
      console.warn(`[OMOCaptcha] Lỗi gửi Slider Task: ${err.message}`);
      return null;
    }
  }

  /**
   * Lấy kết quả giải Captcha theo taskId
   * @param {string} taskId
   * @param {number} maxWaitSeconds Thời gian chờ tối đa (giây)
   * @returns {Promise<{x: number, y?: number, w?: number, h?: number}|null>}
   */
  async getTaskResult(taskId, maxWaitSeconds = 25) {
    if (!this._apiKey || !taskId) return null;

    const startTime = Date.now();
    const waitMs = maxWaitSeconds * 1000;

    // Chờ 1 giây trước khi poll lần đầu
    await new Promise((r) => setTimeout(r, 1000));

    while (Date.now() - startTime < waitMs) {
      try {
        const resp = await axios.post(`${this._baseUrl}/getTaskResult`, {
          clientKey: this._apiKey,
          taskId,
        }, {
          headers: { "Content-Type": "application/json" },
          timeout: 8000,
        });

        const data = resp.data;
        if (data?.errorId === 0) {
          if (data.status === "ready") {
            const rects = data.solution?.rects;
            if (Array.isArray(rects) && rects.length > 0) {
              return rects[0];
            }
            if (data.solution?.x !== undefined) {
              return { x: data.solution.x, y: data.solution.y };
            }
            return data.solution;
          }
          if (data.status === "processing") {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
        }

        if (data?.errorId !== 0) {
          console.warn(`[OMOCaptcha] getTaskResult thất bại: ${data?.errorDescription || data?.errorCode}`);
          return null;
        }
      } catch (err) {
        console.warn(`[OMOCaptcha] Lỗi polling task ${taskId}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    console.warn(`[OMOCaptcha] Quá thời gian chờ kết quả (${maxWaitSeconds}s).`);
    return null;
  }

  /**
   * Phương thức tổng hợp: Gửi ảnh và nhận toạ độ Slider
   * @param {string} imageBase64 
   * @param {number} widthView 
   * @param {number} [heightView] 
   * @returns {Promise<{x: number, y?: number}|null>}
   */
  async solveSlider(imageBase64, widthView, heightView = null) {
    const taskId = await this.createSliderTask(imageBase64, widthView, heightView);
    if (!taskId) return null;
    console.log(`⏳ [OMOCaptcha] Đã tạo Task #${taskId} (Type: SliderAllWebTask, Width: ${widthView}px). Đang chờ AI giải...`);
    const solution = await this.getTaskResult(taskId);
    if (solution && solution.x !== undefined) {
      console.log(`🎯 [OMOCaptcha Slider] Giải thành công! Toạ độ đích X: ${solution.x}px (Y: ${solution.y || 0}px)`);
      return solution;
    }
    return null;
  }
}
