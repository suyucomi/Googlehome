class BackgroundManager {
  constructor() {
    // 使用配置常量
    this.maxFileSize = CONFIG.security.maxFileSize;
    this.supportedFormats = CONFIG.security.supportedImageFormats;
    this.maxWidth = CONFIG.constants.BACKGROUND_MAX_WIDTH;
    this.maxHeight = CONFIG.constants.BACKGROUND_MAX_HEIGHT;
    this.quality = CONFIG.constants.BACKGROUND_QUALITY;
    this.minImageWidth = 800;
    this.minImageHeight = 600;
  }

  // 处理图片上传
  async handleImageUpload(file) {
    console.log('===== 处理图片上传 =====');
    console.log('1. 验证图片');

    if (!this.validateImage(file)) {
      throw new Error(CONFIG.errorMessages.INVALID_URL || '图片格式或大小不符合要求');
    }

    try {
      console.log('2. 开始处理图片');
      ConfigManager.showToast('正在处理图片...', 'info');

      console.log('3. 转换图片');
      const processedImage = await this.processImage(file);

      console.log('4. 图片处理完成');
      return processedImage;
    } catch (error) {
      console.error('图片处理失败:', error);
      // 添加错误恢复机制 - 返回默认背景
      return this.getFallbackBackground();
    }
  }

  // 验证图片
  validateImage(file) {
    console.log('验证图片:', {
      size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
      type: file.type
    });

    if (file.size > this.maxFileSize) {
      ConfigManager.showToast(CONFIG.errorMessages.FILE_TOO_LARGE || '图片大小不能超过5MB', 'error');
      return false;
    }

    if (!this.supportedFormats.includes(file.type)) {
      ConfigManager.showToast(CONFIG.errorMessages.UNSUPPORTED_FORMAT || '仅支持JPG、PNG和WebP格式', 'error');
      return false;
    }

    return true;
  }

  // 处理图片
  async processImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.src = e.target.result;
        img.onload = () => {
          try {
            console.log('图片尺寸:', {
              width: img.width,
              height: img.height
            });

            // 检查图片尺寸
            if (img.width < this.minImageWidth || img.height < this.minImageHeight) {
              ConfigManager.showToast(`图片尺寸过小，建议使用至少${this.minImageWidth}x${this.minImageHeight}的图片`, 'warning');
            }

            // 如果图片太大，进行压缩
            const result = file.size > this.maxFileSize / 2 ?
              this.compressImage(img) : e.target.result;

            resolve(result);
          } catch (error) {
            reject(error);
          }
        };
        img.onerror = () => reject(new Error('图片加载失败'));
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  // 压缩图片 - 优化压缩算法
  compressImage(img) {
    console.log('压缩图片');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // 计算新尺寸 - 使用配置常量
    const { width, height } = this.calculateAspectRatioFit(
      img.width,
      img.height,
      this.maxWidth,
      this.maxHeight
    );

    canvas.width = width;
    canvas.height = height;

    // 使用高质量缩放
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 绘制图片
    ctx.drawImage(img, 0, 0, width, height);

    console.log('压缩后尺寸:', { width, height });
    // 使用配置的质量参数
    return canvas.toDataURL('image/jpeg', this.quality);
  }

  // 获取备用背景
  getFallbackBackground() {
    // 返回默认渐变背景
    return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  }

  // 计算宽高比
  calculateAspectRatioFit(srcWidth, srcHeight, maxWidth, maxHeight) {
    const ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
    return {
      width: Math.round(srcWidth * ratio),
      height: Math.round(srcHeight * ratio)
    };
  }

  // 应用背景效果
  applyBackgroundEffect(container, settings) {
    console.log('===== 应用背景效果 =====');
    if (!container) {
      console.error('容器元素不存在');
      return;
    }

    if (settings.type === 'none') {
      console.log('清除背景');
      this.clearBackground(container);
      return;
    }

    console.log('设置背景:', {
      type: settings.type,
      blur: settings.blur,
      brightness: settings.brightness
    });

    // 应用背景图片
    container.style.backgroundImage = `url(${settings.value})`;
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center';
    container.style.backgroundRepeat = 'no-repeat';
    container.style.transition = 'all 0.3s ease';

    // 应用滤镜效果
    const filters = [];
    if (settings.blur > 0) {
      filters.push(`blur(${settings.blur}px)`);
    }
    if (settings.brightness !== 100) {
      filters.push(`brightness(${settings.brightness}%)`);
    }
    container.style.backdropFilter = filters.join(' ');
  }

  // 清除背景
  clearBackground(container) {
    container.style.backgroundImage = '';
    container.style.backdropFilter = '';
    container.style.backgroundColor = '';
  }

  // 创建预览
  createPreview(imageUrl, settings) {
    console.log('===== 创建预览 =====');
    const preview = document.createElement('div');
    preview.className = 'preview-content';
    
    // 设置背景图片
    preview.style.backgroundImage = `url(${imageUrl})`;
    preview.style.backgroundSize = 'cover';
    preview.style.backgroundPosition = 'center';
    preview.style.transition = 'all 0.3s ease';
    
    // 应用滤镜效果
    const filters = [];
    if (settings.blur > 0) {
      filters.push(`blur(${settings.blur}px)`);
    }
    if (settings.brightness !== 100) {
      filters.push(`brightness(${settings.brightness}%)`);
    }
    preview.style.filter = filters.join(' ');
    
    return preview;
  }
}

window.backgroundManager = new BackgroundManager(); 