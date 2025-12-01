// 将耗时操作移至Web Worker
const worker = new Worker('worker.js');

// 在worker中处理图片压缩
worker.postMessage({
  type: 'compressImage',
  imageData: imageData
});

worker.onmessage = (e) => {
  const compressedImage = e.data;
  updateUI(compressedImage);
}; 