class SettingsManager {
  constructor() {
    this.settings = {
      background: {
        type: 'none',
        value: '',
        blur: 0,
        brightness: 100
      }
    };
    this.tempSettings = null;
    this.init();
  }
  
  async init() {
    try {
      const saved = await chrome.storage.local.get('settings');
      console.log('从存储中读取的设置:', saved);
      
      if (saved.settings) {
        this.settings = { ...this.settings, ...saved.settings };
        this.tempSettings = { ...this.settings };
        console.log('初始化后的设置:', this.settings);
        
        if (this.settings.background && this.settings.background.type === 'image') {
          this.applySettings();
        }
      }
      this.initUI();
    } catch (error) {
      console.error('初始化设置失败:', error);
    }
  }
  
  initUI() {
    this.initBackgroundControls();
  }

  initBackgroundControls() {
    const backgroundFile = document.getElementById('backgroundFile');
    const blurRange = document.getElementById('blurRange');
    const brightnessRange = document.getElementById('brightnessRange');
    const blurValue = document.getElementById('blurValue');
    const brightnessValue = document.getElementById('brightnessValue');
    const confirmBtn = document.getElementById('confirmBackground');
    const previewImage = document.getElementById('previewImage');
    const placeholder = document.getElementById('previewPlaceholder');

    console.log('初始化背景控件:', {
      backgroundFile,
      previewImage,
      placeholder,
      currentSettings: this.settings,
      tempSettings: this.tempSettings
    });

    if (this.settings.background.type === 'image') {
      previewImage.src = this.settings.background.value;
      previewImage.style.display = 'block';
      placeholder.style.display = 'none';
      
      blurRange.value = this.settings.background.blur;
      brightnessRange.value = this.settings.background.brightness;
      blurValue.textContent = this.settings.background.blur;
      brightnessValue.textContent = this.settings.background.brightness;
      
      blurRange.disabled = false;
      brightnessRange.disabled = false;
    }

    // 文件上传
    backgroundFile?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        console.log('选择的文件:', file);
        const reader = new FileReader();
        
        reader.onload = (e) => {
          const imageUrl = e.target.result;
          console.log('图片加载完成, 准备显示');
          
          // 更新预览图片
          previewImage.onload = () => {
            console.log('预览图片加载完成');
            previewImage.style.display = 'block';
            placeholder.style.display = 'none';
            
            // 应用当前的模糊度和亮度设置
            const currentBlur = blurRange.value;
            const currentBrightness = brightnessRange.value;
            previewImage.style.filter = `blur(${currentBlur}px) brightness(${currentBrightness}%)`;
          };
          
          previewImage.onerror = (error) => {
            console.error('预览图片加载失败:', error);
          };
          
          previewImage.src = imageUrl;
          
          // 创建临时设置
          this.tempSettings = {
            ...this.settings,
            background: {
              type: 'image',
              value: imageUrl,
              blur: Number(blurRange.value),
              brightness: Number(brightnessRange.value)
            }
          };

          console.log('更新临时设置:', this.tempSettings);

          // 启用滑块控制
          blurRange.disabled = false;
          brightnessRange.disabled = false;
        };
        
        reader.onerror = (error) => {
          console.error('文件读取失败:', error);
        };
        
        reader.readAsDataURL(file);
      }
    });

    // 模糊度调节
    blurRange?.addEventListener('input', (e) => {
      const value = e.target.value;
      blurValue.textContent = value;
      if (this.tempSettings) {
        this.tempSettings.background.blur = Number(value);
        // 直接更新预览图片的滤镜效果
        previewImage.style.filter = `blur(${value}px) brightness(${this.tempSettings.background.brightness}%)`;
      }
    });

    // 亮度调节
    brightnessRange?.addEventListener('input', (e) => {
      const value = e.target.value;
      brightnessValue.textContent = value;
      if (this.tempSettings) {
        this.tempSettings.background.brightness = Number(value);
        // 直接更新预览图片的滤镜效果
        previewImage.style.filter = `blur(${this.tempSettings.background.blur}px) brightness(${value}%)`;
      }
    });

    // 确认按钮
    confirmBtn?.addEventListener('click', () => {
      console.log('点击确认按钮，当前临时设置:', this.tempSettings);
      console.log('当前设置:', this.settings);
      
      if (this.tempSettings) {
        this.settings = { ...this.tempSettings };
        console.log('应用新设置:', this.settings);
        
        this.applySettings();
        
        // 保存到存储
        chrome.storage.local.set({ settings: this.settings }, () => {
          if (chrome.runtime.lastError) {
            console.error('保存设置失败:', chrome.runtime.lastError);
            ConfigManager.showToast('保存设置失败', 'error');
          } else {
            console.log('设置已保存到存储');
            ConfigManager.showToast('背景设置已保存');
          }
        });
      } else {
        console.warn('没有临时设置可以应用');
      }
    });
  }
  
  applySettings() {
    const container = document.querySelector('.container');
    const previewImage = document.getElementById('previewImage');
    const placeholder = document.getElementById('previewPlaceholder');
    
    console.log('开始应用设置:', this.settings);
    
    if (container && this.settings.background) {
      const { type, value, blur, brightness } = this.settings.background;
      
      if (type === 'image' && value) {
        // 更新预览图片
        previewImage.src = value;
        previewImage.style.display = 'block';
        previewImage.style.filter = `blur(${blur}px) brightness(${brightness}%)`;
        placeholder.style.display = 'none';
        
        // 新主容器背景
        let backgroundDiv = document.querySelector('.background-layer');
        let oldBackgroundDiv = document.querySelector('.background-layer-old');
        
        // 如果存在旧的背景层，先移除
        if (oldBackgroundDiv) {
          oldBackgroundDiv.remove();
        }
        
        // 如果已经有背景层，将其标记为旧的
        if (backgroundDiv) {
          backgroundDiv.className = 'background-layer-old';
          backgroundDiv.style.opacity = '1';
          oldBackgroundDiv = backgroundDiv;
        }
        
        // 创建新的背景层
        backgroundDiv = document.createElement('div');
        backgroundDiv.className = 'background-layer';
        document.body.insertBefore(backgroundDiv, document.body.firstChild);
        
        // 设置背景层的基础样式
        const baseStyle = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100vw;
          height: 100vh;
          background-image: url(${value});
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          z-index: -1;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.6s ease, filter 0.6s ease;
        `;
        
        // 先设置基础样式
        backgroundDiv.style.cssText = baseStyle;
        
        // 强制重绘
        backgroundDiv.offsetHeight;
        
        // 设置完整样式，包括滤镜效果
        backgroundDiv.style.cssText = baseStyle + `
          opacity: 1;
          filter: blur(${blur}px) brightness(${brightness}%);
        `;
        
        // 确保容器背景透明
        container.style.background = 'transparent';
        
        // 如果有旧的背景层，淡出并移除
        if (oldBackgroundDiv) {
          oldBackgroundDiv.style.opacity = '0';
          setTimeout(() => {
            if (oldBackgroundDiv.parentNode) {
              oldBackgroundDiv.remove();
            }
          }, 600);
        }

        // 确保所有图标都有正确的悬浮效果
        this.updateSquaresHoverEffect();
        
        console.log('背景已更新');
      } else {
        // 如果没有背景图片，显示占位符
        previewImage.style.display = 'none';
        placeholder.style.display = 'flex';
        
        // 淡出并移除背景层
        const backgroundDiv = document.querySelector('.background-layer');
        const oldBackgroundDiv = document.querySelector('.background-layer-old');
        
        if (backgroundDiv) {
          backgroundDiv.style.opacity = '0';
          setTimeout(() => {
            if (backgroundDiv.parentNode) {
              backgroundDiv.remove();
            }
          }, 600);
        }
        
        if (oldBackgroundDiv) {
          oldBackgroundDiv.style.opacity = '0';
          setTimeout(() => {
            if (oldBackgroundDiv.parentNode) {
              oldBackgroundDiv.remove();
            }
          }, 600);
        }
        
        // 恢复容器背景色，添加过渡效果
        container.style.transition = 'background-color 0.6s ease';
        container.style.backgroundColor = '#202124';
        
        console.log('已清除背景');
      }
    }
  }

  // 添加新方法：更新所有图标的悬浮效果
  updateSquaresHoverEffect() {
    const squares = document.querySelectorAll('.square-container');
    
    squares.forEach(square => {
      // 移除旧的样式类
      square.classList.remove('square-hover-effect');
      
      // 重新应用样式
      square.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s ease, box-shadow 0.2s ease';
      
      // 添加新的样式类
      square.classList.add('square-hover-effect');
    });
  }
}

// 创建全局实例
const settingsManager = new SettingsManager();
window.settingsManager = settingsManager; 