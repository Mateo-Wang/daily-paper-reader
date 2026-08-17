# Intern-S2-Preview: Scientific Agentic Foundation Model

**Tags**: `frontier`

**本周前沿**: 2026-W34

**类型**: 论文

**来源**: arXiv

**发布日期**: 2026-08-13

**前沿评分**: 9.0 / 10

**原始链接**: [https://arxiv.org/abs/2608.13505v1](https://arxiv.org/abs/2608.13505v1)

## 为什么值得跨领域阅读

作为科学智能体基础模型，统一多模态理解、推理与长程工具交互，可迁移至多科学领域。

## 概述

Scientific discovery increasingly requires AI systems that can reason over scientific evidence of heterogeneous modalities, interact with scientific tools and environments, and sustain progress across long task horizons. We present Intern-S2-Preview, a series of scientific agentic foundation models designed to support multimodal scientific understanding, reasoning, generation, and long-horizon tasks. The training pipeline begins with scientific multimodal pre-training over rendered scientific documents, interleaved image-text data, and diverse scientific corpora. Starting from the pretrained checkpoint, we apply a unified post-training pipeline consisting of supervised fine-tuning, scalable multi-task reinforcement learning (RL), black- and white-box agentic RL, and on-policy distillation. This pipeline is supported by practical techniques that improve rollout and training stability and efficiency, including partial rollout with off-policy correction, adaptive length regularization, online speculative decoding, robust multi-task optimization, and trace-aware experience assembly for agentic tasks. At the architecture level, Intern-S2-Preview-397B extends time series modelling from efficient long-sequence understanding to numerical forecasting, while Memory Decoder is studied as a separate memory-augmented path for rapid scientific specialization without modifying the frozen 397B backbone. Evaluations across scientific, multimodal, agentic, and general-purpose benchmarks show that Intern-S2-Preview-397B achieves competitive or leading results in multiple settings. The time series modules improve scientific signal understanding and forecasting on SciTS, while the separate Intern-MemDec-4B extension improves the Biology-Instructions average score from 56.92 to 60.32 without modifying the frozen 397B backbone.

## 核心贡献

构建了科学智能体基础模型及可扩展训练框架，支撑长周期科学发现任务。

## 证据与影响信号

论文展示了从多模态预训练到多任务RL和智能体RL的完整训练管线，并推出397B参数模型。

## 局限与阅读提示

摘要未给出具体基准结果，实际有效性和泛化能力有待验证。

## 与你的研究方向的连接

- 自动驾驶：其长程规划与工具调用能力可间接用于自动驾驶复杂场景推理。
- 机器人：可作为机器人科学任务的高层任务规划和多模态理解基座。
