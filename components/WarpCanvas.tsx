"use client";

import { useEffect, useRef } from 'react';

interface WarpCanvasProps {
  isDark: boolean;
  sunPos?: { left: string; bottom: string };
}

export default function WarpCanvas({ isDark, sunPos }: WarpCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width: number, height: number;
    let animationFrameId: number;

    // --- DARK MODE ASSETS (Hyperespace) ---
    const numStars = 200;
    const numBgStars = 100;
    const speed = 0.001;
    const angleRad = 35 * (Math.PI / 180);

    class Star {
      x: number = 0;
      y: number = 0;
      z: number = 0;
      prevZ: number = 0;
      brightness: number = 0;
      isBackground: boolean;

      constructor(isBackground: boolean = false) {
        this.isBackground = isBackground;
        this.reset();
      }

      reset() {
        this.x = (Math.random() - 0.5) * 3.5;
        this.y = (Math.random() - 0.5) * 2.5;
        this.z = this.isBackground ? 1 : Math.random();
        this.prevZ = this.z;
        this.brightness = 0.5 + Math.random() * 0.5;
      }

      update() {
        if (this.isBackground) {
          this.x -= 0.0003;
          if (this.x < -2) this.x = 2;
        } else {
          this.prevZ = this.z;
          this.z -= speed;
          if (this.z <= 0) this.reset();
        }
      }

      draw() {
        const angleOffset = Math.tan(angleRad) * (1 - this.z) * (width / 2);
        const x2d = (this.x / this.z) * (width / 2) + (width / 2) + angleOffset;
        const y2d = (this.y / this.z) * (height / 2) + (height / 2);

        if (x2d < 0 || x2d > width || y2d < 0 || y2d > height) return;

        if (this.isBackground) {
          ctx!.fillStyle = `rgba(255, 255, 255, ${this.brightness * 0.4})`;
          ctx!.fillRect(x2d % width, y2d % height, 1, 1);
        } else {
          const closeness = 1 - this.z;
          if (closeness < 0.5) {
            ctx!.fillStyle = `rgba(255, 255, 255, ${closeness})`;
            ctx!.fillRect(x2d, y2d, 1.5, 1.5);
          } else {
            const glowSize = (0.1 + (closeness * closeness) * 2.5) * 4;
            const gradient = ctx!.createRadialGradient(x2d, y2d, 0, x2d, y2d, glowSize);
            gradient.addColorStop(0, 'white');
            gradient.addColorStop(0.5, `rgba(255, 255, 255, 0.3)`);
            gradient.addColorStop(1, 'transparent');
            ctx!.fillStyle = gradient;
            ctx!.beginPath();
            ctx!.arc(x2d, y2d, glowSize, 0, Math.PI * 2);
            ctx!.fill();
          }
        }
      }
    }

    // --- DAY MODE ASSETS ---
    class Cloud {
      x: number = 0;
      y: number = 0;
      sizeX: number = 0;
      sizeY: number = 0;
      speed: number = 0;
      opacity: number = 0;

      constructor() {
        this.reset();
        this.x = Math.random() * width;
      }

      reset() {
        this.x = -600;
        this.y = Math.random() * (height * 0.4);
        this.sizeX = 400 + Math.random() * 400;
        this.sizeY = 150 + Math.random() * 150;
        this.speed = 0.1 + Math.random() * 0.2;
        this.opacity = 0.02 + Math.random() * 0.05;
      }

      update() {
        this.x += this.speed;
        if (this.x > width + 600) this.reset();
      }

      draw() {
        ctx!.save();
        const grad = ctx!.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.sizeX);
        grad.addColorStop(0, `rgba(255, 255, 255, ${this.opacity})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx!.fillStyle = grad;
        ctx!.translate(this.x, this.y);
        ctx!.scale(1.5, 0.6);
        ctx!.beginPath();
        ctx!.arc(0, 0, this.sizeX / 1.5, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.restore();
      }
    }

    class Bird {
      x: number = 0;
      y: number = 0;
      speed: number = 0;
      size: number = 0;
      wingPhase: number = 0;

      constructor() {
        this.reset();
        this.x = Math.random() * width;
      }

      reset() {
        this.x = -50;
        this.y = 50 + Math.random() * (height * 0.3);
        this.speed = 0.5 + Math.random() * 1.5;
        this.size = 2 + Math.random() * 3;
        this.wingPhase = Math.random() * Math.PI * 2;
      }

      update() {
        this.x += this.speed;
        this.wingPhase += 0.15;
        if (this.x > width + 50) this.reset();
      }

      draw() {
        const wingY = Math.sin(this.wingPhase) * (this.size * 0.8);
        ctx!.strokeStyle = 'rgba(0, 0, 0, 0.15)';
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        // Left wing
        ctx!.moveTo(this.x - this.size, this.y + wingY);
        ctx!.quadraticCurveTo(this.x - this.size / 2, this.y - this.size / 4, this.x, this.y);
        // Right wing
        ctx!.quadraticCurveTo(this.x + this.size / 2, this.y - this.size / 4, this.x + this.size, this.y + wingY);
        ctx!.stroke();
      }
    }

    let stars: Star[] = [];
    let bgStars: Star[] = [];
    let clouds: Cloud[] = [];
    let birds: Bird[] = [];
    let waveOffset = 0;

    const init = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      stars = Array.from({ length: numStars }, () => new Star(false));
      bgStars = Array.from({ length: numBgStars }, () => new Star(true));
      clouds = Array.from({ length: 6 }, () => new Cloud());
      birds = Array.from({ length: 4 }, () => new Bird());
    };

    const drawBeach = () => {
      const beachHeight = height * 0.12;
      
      // Foam/Wave movement
      const foamOffset = Math.sin(waveOffset * 2) * 5;

      // 1. Sand
      ctx!.fillStyle = '#fdf8f1';
      ctx!.beginPath();
      ctx!.moveTo(0, height + 100);
      ctx!.lineTo(0, height - beachHeight);
      ctx!.bezierCurveTo(width * 0.3, height - beachHeight - 30, width * 0.7, height - beachHeight + 20, width, height - beachHeight - 10);
      ctx!.lineTo(width, height + 100);
      ctx!.fill();

      // 2. Foam (The wave edge)
      ctx!.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.moveTo(0, height - beachHeight - 2 + foamOffset);
      ctx!.bezierCurveTo(width * 0.3, height - beachHeight - 32 + foamOffset, width * 0.7, height - beachHeight + 18 + foamOffset, width, height - beachHeight - 12 + foamOffset);
      ctx!.stroke();
    };

    const drawSea = () => {
      waveOffset += 0.004;
      const seaHeight = height * 0.28;
      const seaTop = height - seaHeight;

      // Layer 1: Back (Deepest)
      ctx!.fillStyle = 'rgba(0, 80, 255, 0.03)';
      ctx!.beginPath();
      ctx!.moveTo(0, height);
      ctx!.lineTo(0, seaTop);
      for (let x = 0; x <= width; x += 15) {
        ctx!.lineTo(x, seaTop + Math.sin(x * 0.004 + waveOffset) * 20);
      }
      ctx!.lineTo(width, height + 100);
      ctx!.lineTo(0, height + 100);
      ctx!.fill();

      // Layer 2: Middle
      ctx!.fillStyle = 'rgba(0, 100, 255, 0.05)';
      ctx!.beginPath();
      ctx!.moveTo(0, height + 100);
      ctx!.lineTo(0, seaTop + 30);
      for (let x = 0; x <= width; x += 15) {
        ctx!.lineTo(x, seaTop + 30 + Math.sin(x * 0.006 + waveOffset * 0.8) * 12);
      }
      ctx!.lineTo(width, height + 100);
      ctx!.lineTo(0, height + 100);
      ctx!.fill();

      // Layer 3: Front
      ctx!.fillStyle = 'rgba(0, 122, 255, 0.07)';
      ctx!.beginPath();
      ctx!.moveTo(0, height + 100);
      ctx!.lineTo(0, seaTop + 60);
      for (let x = 0; x <= width; x += 15) {
        ctx!.lineTo(x, seaTop + 60 + Math.sin(x * 0.008 + waveOffset * 1.2) * 8);
      }
      ctx!.lineTo(width, height + 100);
      ctx!.lineTo(0, height + 100);
      ctx!.fill();
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      if (isDark) {
        bgStars.forEach(s => { s.update(); s.draw(); });
        stars.forEach(s => { s.update(); s.draw(); });
      } else {
        // Sea Background
        drawSea();
        drawBeach();

        clouds.forEach(c => { c.update(); c.draw(); });
        birds.forEach(b => { b.update(); b.draw(); });
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener('resize', init);
    init();
    animate();

    return () => {
      window.removeEventListener('resize', init);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isDark]);

  return <canvas ref={canvasRef} id="warpCanvas" />;
}
