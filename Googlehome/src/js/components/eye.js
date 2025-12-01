document.addEventListener('DOMContentLoaded', function() {
  const eyes = document.querySelectorAll('.eye-inner');
  const pupils = document.querySelectorAll('.pupil');
  
  document.addEventListener('mousemove', function(e) {
    eyes.forEach((eye, index) => {
      const eyeRect = eye.getBoundingClientRect();
      const eyeCenterX = eyeRect.left + eyeRect.width / 2;
      const eyeCenterY = eyeRect.top + eyeRect.height / 2;
      
      // 计算鼠标和眼睛中心的角度
      const angle = Math.atan2(e.clientY - eyeCenterY, e.clientX - eyeCenterX);
      
      // 限制眼球移动的半径
      const distance = Math.min(8, Math.hypot(e.clientX - eyeCenterX, e.clientY - eyeCenterY) / 10);
      
      // 计算眼球的新位置
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      
      // 应用变换
      pupils[index].style.transform = `translate(${x}px, ${y}px)`;
    });
  });
}); 