document.addEventListener('DOMContentLoaded', function() {
  // 使用 requestAnimationFrame 优化动画性能
  const animationManager = {
    animations: new Map(),
    
    // 添加动画
    add(element, options) {
      const animation = {
        element,
        options,
        startTime: performance.now(),
        isRunning: true
      };
      
      this.animations.set(element, animation);
      if (this.animations.size === 1) {
        this.startAnimationLoop();
      }
    },
    
    // 移除动画
    remove(element) {
      this.animations.delete(element);
    },
    
    // 动画循环
    animate(currentTime) {
      this.animations.forEach((animation, element) => {
        if (!animation.isRunning) return;
        
        const elapsed = currentTime - animation.startTime;
        const { duration = 4500, easing = 'ease-in-out' } = animation.options;
        
        // 计算进度
        let progress = Math.min(elapsed / duration, 1);
        
        // 应用缓动函数
        progress = this.applyEasing(progress, easing);
        
        // 应用动画效果
        this.applyAnimation(element, progress, animation.options);
        
        // 检查动画是否完成
        if (progress >= 1) {
          if (animation.options.loop) {
            animation.startTime = currentTime;
          } else {
            animation.isRunning = false;
            this.animations.delete(element);
          }
        }
      });
      
      // 继续动画循环
      if (this.animations.size > 0) {
        requestAnimationFrame(this.animate.bind(this));
      }
    },
    
    // 启动动画循环
    startAnimationLoop() {
      requestAnimationFrame(this.animate.bind(this));
    },
    
    // 缓动函数
    applyEasing(progress, easing) {
      switch (easing) {
        case 'ease-in':
          return progress * progress;
        case 'ease-out':
          return 1 - Math.pow(1 - progress, 2);
        case 'ease-in-out':
          return progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        default:
          return progress;
      }
    },
    
    // 应用动画效果
    applyAnimation(element, progress, options) {
      const {
        type = 'breathe',
        scale = [1, 1.1],
        opacity = [1, 0.7],
        translateY = [0, -3],
        blur = [0, 4],
        glow = false
      } = options;
      
      // 使用 transform 和 opacity 实现动画
      switch (type) {
        case 'breathe':
          const currentScale = this.interpolate(progress, scale[0], scale[1]);
          const currentOpacity = this.interpolate(progress, opacity[0], opacity[1]);
          
          element.style.transform = `scale(${currentScale})`;
          element.style.opacity = currentOpacity;
          
          // 添加发光效果
          if (glow) {
            const glowIntensity = Math.sin(progress * Math.PI) * 0.5 + 0.5;
            element.style.boxShadow = `0 0 ${25 * glowIntensity}px ${2 * glowIntensity}px rgba(255, 255, 255, ${0.3 * glowIntensity})`;
            element.style.borderColor = `rgba(255, 255, 255, ${0.3 + 0.2 * glowIntensity})`;
          }
          break;
          
        case 'hover':
          const currentTranslateY = this.interpolate(progress, translateY[0], translateY[1]);
          const currentBlur = this.interpolate(progress, blur[0], blur[1]);
          
          element.style.transform = `translateY(${currentTranslateY}px)`;
          element.style.filter = `blur(${currentBlur}px)`;
          break;
      }
    },
    
    // 值插值计算
    interpolate(progress, start, end) {
      return start + (end - start) * progress;
    }
  };

  // 优化搜索框动画
  const searchInput = document.getElementById('searchInput');
  const searchSelect = document.getElementById('searchEngine');
  
  if (searchInput && searchSelect) {
    // 添加搜索框呼吸动画
    animationManager.add(searchInput, {
      type: 'breathe',
      duration: 4500,
      loop: true,
      scale: [1, 1],
      opacity: [1, 1],
      glow: true
    });
    
    // 添加搜索引擎选择器动画
    animationManager.add(searchSelect, {
      type: 'breathe',
      duration: 4500,
      loop: true,
      scale: [1, 1],
      opacity: [1, 1],
      glow: true
    });
  }

  // 优化图标悬浮动画
  document.querySelectorAll('.square-container').forEach(square => {
    square.addEventListener('mouseenter', () => {
      animationManager.add(square, {
        type: 'hover',
        duration: 300,
        translateY: [0, -3],
        scale: [1, 1.1]
      });
    });
    
    square.addEventListener('mouseleave', () => {
      animationManager.add(square, {
        type: 'hover',
        duration: 300,
        translateY: [-3, 0],
        scale: [1.1, 1]
      });
    });
  });

  // 优化背景切换动画
  const backgroundTransition = {
    duration: 600,
    
    // 切换背景
    async change(newBackground) {
      const container = document.querySelector('.container');
      const oldLayer = document.querySelector('.background-layer');
      
      // 创建新背景层
      const newLayer = document.createElement('div');
      newLayer.className = 'background-layer';
      newLayer.style.backgroundImage = `url(${newBackground})`;
      newLayer.style.opacity = '0';
      
      // 使用 GPU 加速
      newLayer.style.transform = 'translate3d(0,0,0)';
      newLayer.style.willChange = 'opacity';
      
      document.body.insertBefore(newLayer, oldLayer);
      
      // 等待下一帧以确保样式已应用
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // 淡入新背景
      newLayer.style.opacity = '1';
      
      // 如果有旧背景，淡出并移除
      if (oldLayer) {
        oldLayer.style.opacity = '0';
        setTimeout(() => oldLayer.remove(), this.duration);
      }
    }
  };

  // 导出动画管理器供其他模块使用
  window.animationManager = animationManager;
  window.backgroundTransition = backgroundTransition;
}); 