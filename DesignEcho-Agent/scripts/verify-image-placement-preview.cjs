const assert = require('node:assert/strict');
const path = require('node:path');

const agentRoot = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(agentRoot, 'tsconfig.main.json')
});

const {
    previewImagePlacement
} = require(path.join(agentRoot, 'src/shared/layout/image-placement-preview.ts'));
const {
    buildImagePlacementPrewritePlan
} = require(path.join(agentRoot, 'src/shared/layout/image-placement-prewrite-plan.ts'));
const {
    measureImageTargetFitOutcome,
    resolveImageTargetFitPlan
} = require(path.join(agentRoot, '../DesignEcho-UXP/src/core/image-target-fit.ts'));

let passed = 0;

function check(label, verify) {
    try {
        verify();
        passed += 1;
        console.log(`  ✓ ${label}`);
    } catch (error) {
        console.error(`  ✗ ${label}`);
        throw error;
    }
}

function closeTo(actual, expected, tolerance = 1e-9) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`
    );
}

function expectPreview(input) {
    const result = previewImagePlacement(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.preview;
}

function expectIssue(input, code) {
    const result = previewImagePlacement(input);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(result.issues.some((issue) => issue.code === code), JSON.stringify(result.issues));
}

function expectPrewritePlan(input) {
    const result = buildImagePlacementPrewritePlan(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.plan;
}

function expectPrewriteIssue(input, code) {
    const result = buildImagePlacementPrewritePlan(input);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(result.issues.some((issue) => issue.code === code), JSON.stringify(result.issues));
    return result.issues;
}

function assertBoundsClose(actual, expected, tolerance = 1e-9) {
    closeTo(actual.x, expected.x, tolerance);
    closeTo(actual.y, expected.y, tolerance);
    closeTo(actual.width, expected.width, tolerance);
    closeTo(actual.height, expected.height, tolerance);
}

function toUxpRect(bounds) {
    return {
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height
    };
}

function assertMatchesUxp(input) {
    const preview = expectPreview(input);
    const uxpPlan = resolveImageTargetFitPlan({
        sourceBounds: {
            left: 0,
            top: 0,
            width: input.source.width,
            height: input.source.height
        },
        targetBounds: toUxpRect(input.targetBounds),
        fit: input.fit,
        targetAnchor: input.anchor,
        focalPoint: input.focalPoint
    });
    const uxpOutcome = measureImageTargetFitOutcome(uxpPlan, uxpPlan.expectedBounds);
    assertBoundsClose(preview.plannedBounds, {
        x: uxpPlan.expectedBounds.left,
        y: uxpPlan.expectedBounds.top,
        width: uxpPlan.expectedBounds.width,
        height: uxpPlan.expectedBounds.height
    });
    closeTo(preview.scale.xPercent, uxpPlan.widthPercent);
    closeTo(preview.scale.yPercent, uxpPlan.heightPercent);
    closeTo(preview.insideTarget.frameRatio, uxpOutcome.insideTargetRatio);
    closeTo(preview.insideTarget.targetRatio, uxpOutcome.targetCoverageRatio);
    assert.deepEqual(preview.outsideTarget.edges, uxpOutcome.outsideTargetEdges);
    closeTo(preview.outsideTarget.frameRatio, uxpOutcome.outsideTargetFraction);
    if (input.focalPoint) {
        assert.equal(preview.focalPoint?.clamped, uxpPlan.focalPointClamped);
    }
    if (input.focalPoint && uxpOutcome.focalDeviationPx !== undefined) {
        closeTo(preview.focalPoint?.deviation.distance, uxpOutcome.focalDeviationPx);
    }
}

console.log('[1] 当前 UXP contain / cover / fill 语义');

check('contain 等比完整放入并按 center 留白', () => {
    const preview = expectPreview({
        source: { width: 100, height: 200 },
        targetBounds: { x: 10, y: 20, width: 300, height: 300 },
        fit: 'contain',
        anchor: 'center'
    });
    assertBoundsClose(preview.plannedBounds, { x: 85, y: 20, width: 150, height: 300 });
    closeTo(preview.insideTarget.frameRatio, 1);
    closeTo(preview.insideTarget.targetRatio, 0.5);
    closeTo(preview.outsideTarget.frameRatio, 0);
    assert.deepEqual(preview.outsideTarget.edges, []);
});

check('fill 精确拉伸到目标框并如实返回非等比缩放', () => {
    const preview = expectPreview({
        source: { width: 100, height: 200 },
        targetBounds: { x: 10, y: 20, width: 300, height: 300 },
        fit: 'fill',
        anchor: 'center'
    });
    assertBoundsClose(preview.plannedBounds, { x: 10, y: 20, width: 300, height: 300 });
    closeTo(preview.scale.x, 3);
    closeTo(preview.scale.y, 1.5);
    closeTo(preview.insideTarget.frameRatio, 1);
    closeTo(preview.insideTarget.targetRatio, 1);
});

check('真实竖图 cover 短横框时精确报告约 58.9% 图框位于目标外', () => {
    const preview = expectPreview({
        source: { width: 4672, height: 6453 },
        targetBounds: { x: 0, y: 4649, width: 750, height: 426 },
        fit: 'cover',
        anchor: 'center',
        subjectBox: { x: 0, y: 0, width: 1, height: 1 }
    });
    closeTo(preview.plannedBounds.width, 750);
    closeTo(preview.plannedBounds.height, 1035.9053938356165);
    closeTo(preview.plannedBounds.y, 4344.047303082192);
    closeTo(preview.insideTarget.frameRatio, 0.41123446459011315);
    closeTo(preview.outsideTarget.frameRatio, 0.5887655354098869);
    assert.deepEqual(preview.outsideTarget.edges, ['top', 'bottom']);
    closeTo(preview.subject.visibleRatio, 0.41123446459011315);
    assert.deepEqual(preview.subject.clippedEdges, ['top', 'bottom']);
});

console.log('[2] anchor 与 focalPoint');

check('top-center 与 bottom-center 按 UXP 图框锚点语义落位', () => {
    const common = {
        source: { width: 4672, height: 6453 },
        targetBounds: { x: 0, y: 4649, width: 750, height: 426 },
        fit: 'cover'
    };
    const top = expectPreview({ ...common, anchor: 'top-center' });
    const bottom = expectPreview({ ...common, anchor: 'bottom-center' });
    closeTo(top.plannedBounds.y, 4649);
    closeTo(top.outsideTarget.distance.top, 0);
    closeTo(top.outsideTarget.distance.bottom, top.plannedBounds.height - 426);
    closeTo(bottom.plannedBounds.y, 4649 + 426 - bottom.plannedBounds.height);
    closeTo(bottom.outsideTarget.distance.bottom, 0);
    closeTo(bottom.outsideTarget.distance.top, bottom.plannedBounds.height - 426);
});

check('focalPoint 优先对准目标中心，并如实报告边界夹取与偏差', () => {
    const preview = expectPreview({
        source: { width: 1000, height: 500 },
        targetBounds: { x: 100, y: 200, width: 400, height: 400 },
        fit: 'cover',
        anchor: 'center',
        focalPoint: { x: 0.8, y: 0.5 }
    });
    assertBoundsClose(preview.plannedBounds, { x: -300, y: 200, width: 800, height: 400 });
    assert.equal(preview.focalPoint.clamped, true);
    assertBoundsClose(preview.focalPoint.desiredBounds, { x: -340, y: 200, width: 800, height: 400 });
    closeTo(preview.focalPoint.plannedPosition.x, 340);
    closeTo(preview.focalPoint.targetPosition.x, 300);
    closeTo(preview.focalPoint.deviation.x, 40);
    closeTo(preview.focalPoint.deviation.y, 0);
    closeTo(preview.focalPoint.deviation.distance, 40);
});

check('中心 focalPoint 能完全兑现且不报告夹取', () => {
    const preview = expectPreview({
        source: { width: 1000, height: 500 },
        targetBounds: { x: 100, y: 200, width: 400, height: 400 },
        fit: 'cover',
        anchor: 'top-center',
        focalPoint: { x: 0.5, y: 0.5 }
    });
    assert.equal(preview.effectiveAlignment, 'focal-point');
    assert.equal(preview.focalPoint.clamped, false);
    closeTo(preview.focalPoint.deviation.distance, 0);
});

console.log('[3] 主体框事实与职责边界');

check('图框被裁时，位于中央可见带的主体仍可精确报告为完整可见', () => {
    const preview = expectPreview({
        source: { width: 4672, height: 6453 },
        targetBounds: { x: 0, y: 4649, width: 750, height: 426 },
        fit: 'cover',
        anchor: 'center',
        subjectBox: { x: 0.2, y: 0.35, width: 0.6, height: 0.3 }
    });
    assert.ok(preview.outsideTarget.frameRatio > 0.58);
    closeTo(preview.subject.visibleRatio, 1);
    assert.deepEqual(preview.subject.clippedEdges, []);
});

check('主体跨过目标上边界时返回精确的局部可见比例与方向', () => {
    const preview = expectPreview({
        source: { width: 100, height: 100 },
        targetBounds: { x: 0, y: 0, width: 100, height: 50 },
        fit: 'cover',
        anchor: 'center',
        subjectBox: { x: 0, y: 0, width: 1, height: 0.5 }
    });
    assertBoundsClose(preview.subject.plannedBounds, {
        x: 0,
        y: -25,
        width: 100,
        height: 50
    });
    closeTo(preview.subject.visibleRatio, 0.5);
    assert.deepEqual(preview.subject.clippedEdges, ['top']);
    closeTo(preview.subject.outsideDistance.top, 25);
});

check('预览只返回几何事实，不产生 cropRisk、阈值或审美裁决', () => {
    const preview = expectPreview({
        source: { width: 4672, height: 6453 },
        targetBounds: { x: 0, y: 4649, width: 750, height: 426 },
        fit: 'cover',
        anchor: 'center'
    });
    const serialized = JSON.stringify(preview);
    assert.equal(preview.boundaries.factsOnly, true);
    assert.equal(preview.boundaries.noAestheticVerdict, true);
    assert.equal(preview.boundaries.noHiddenThresholds, true);
    assert.ok(!serialized.includes('cropRisk'));
    assert.ok(!serialized.includes('qualityState'));
    assert.ok(!serialized.includes('recommendedAction'));
    assert.ok(!serialized.includes('severity'));
});

console.log('[4] 非法或含糊输入');

check('fit 与 anchor 缺失时不继承 UXP 兼容默认值', () => {
    const result = previewImagePlacement({
        source: { width: 100, height: 100 },
        targetBounds: { x: 0, y: 0, width: 100, height: 100 }
    });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === 'explicit_supported_fit_required'));
    assert.ok(result.issues.some((issue) => issue.code === 'explicit_supported_anchor_required'));
});

check('fill 拒绝无意义的非中心锚点与 focalPoint', () => {
    expectIssue({
        source: { width: 100, height: 100 },
        targetBounds: { x: 0, y: 0, width: 200, height: 100 },
        fit: 'fill',
        anchor: 'top-center',
        focalPoint: { x: 0.5, y: 0.5 }
    }, 'fill_requires_center_anchor');
    expectIssue({
        source: { width: 100, height: 100 },
        targetBounds: { x: 0, y: 0, width: 200, height: 100 },
        fit: 'fill',
        anchor: 'center',
        focalPoint: { x: 0.5, y: 0.5 }
    }, 'fill_rejects_focal_point');
});

check('越过源图边界的归一化主体框被明确拒绝，不静默夹回', () => {
    expectIssue({
        source: { width: 100, height: 100 },
        targetBounds: { x: 0, y: 0, width: 100, height: 100 },
        fit: 'contain',
        anchor: 'center',
        subjectBox: { x: 0.8, y: 0.2, width: 0.3, height: 0.5 }
    }, 'normalized_subject_box_required');
});

console.log('[5] 与 UXP image-target-fit 逐项一致');

const parityCases = [
    {
        source: { width: 100, height: 200 },
        targetBounds: { x: 10, y: 20, width: 300, height: 300 },
        fit: 'contain', anchor: 'center'
    },
    {
        source: { width: 4672, height: 6453 },
        targetBounds: { x: 0, y: 4649, width: 750, height: 426 },
        fit: 'cover', anchor: 'top-center'
    },
    {
        source: { width: 4672, height: 6453 },
        targetBounds: { x: 0, y: 4649, width: 750, height: 426 },
        fit: 'cover', anchor: 'bottom-center'
    },
    {
        source: { width: 1000, height: 500 },
        targetBounds: { x: 100, y: 200, width: 400, height: 400 },
        fit: 'cover', anchor: 'center', focalPoint: { x: 0.8, y: 0.5 }
    },
    {
        source: { width: 100, height: 200 },
        targetBounds: { x: -20, y: 35, width: 300, height: 120 },
        fit: 'fill', anchor: 'center'
    }
];

parityCases.forEach((fixture, index) => {
    check(`Agent 预览与 UXP 几何一致 #${index + 1}`, () => {
        assertMatchesUxp(fixture);
    });
});

console.log('[6] 写前计划：普通落位与主体占比单次图框');

const normalPrewriteInput = {
    source: {
        width: 100,
        height: 200,
        subject: {
            box: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
            method: 'alpha',
            confidence: 'certain'
        }
    },
    target: { x: 10, y: 20, width: 300, height: 300 },
    placement: {
        fit: 'contain',
        anchor: 'center',
        cropPolicy: 'avoid-crop'
    },
    canvas: { width: 800, height: 800 }
};

check('普通模式保留 Agent 声明，并把普通预演直接作为唯一写入计划', () => {
    const plan = expectPrewritePlan(normalPrewriteInput);
    assert.equal(plan.mode, 'normal');
    assert.deepEqual(plan.finalWrite.targetBounds, normalPrewriteInput.target);
    assert.equal(plan.finalWrite.fit, 'contain');
    assert.equal(plan.finalWrite.anchor, 'center');
    assert.equal(plan.finalWrite.preview, plan.normalPreview);
    assert.equal(plan.subjectFill, undefined);
});

check('主体占比模式求出一次最终图框，并用最终 contain 写入预演做预验证', () => {
    const plan = expectPrewritePlan({
        source: {
            width: 1000,
            height: 1000,
            subject: {
                box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
                method: 'trim',
                confidence: 'high'
            }
        },
        target: { x: 100, y: 200, width: 400, height: 300 },
        placement: {
            fit: 'contain',
            anchor: 'center',
            cropPolicy: 'protect-subject',
            subjectFillRatio: 0.8
        },
        canvas: { width: 800, height: 800 }
    });
    assert.equal(plan.mode, 'subject-fill-once');
    closeTo(plan.subjectFill.requiredScaleRatio, 0.48);
    assert.equal(plan.subjectFill.preverification.status, 'passed');
    assert.deepEqual(plan.finalWrite.targetBounds, {
        x: 60,
        y: 110,
        width: 480,
        height: 480
    });
    assert.equal(plan.finalWrite.fit, 'contain');
    assert.equal(plan.finalWrite.anchor, 'center');
    assert.equal(plan.finalWrite.focalPoint, undefined);
    closeTo(plan.finalWrite.preview.subject.visibleRatio, 1);
});

check('主体占比计划不继承 subject-fit 的三倍兼容上限，所需放大倍数作为事实返回', () => {
    const plan = expectPrewritePlan({
        source: {
            width: 100,
            height: 100,
            subject: {
                box: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
                method: 'alpha',
                confidence: 'certain'
            }
        },
        target: { x: 0, y: 0, width: 1000, height: 1000 },
        placement: {
            fit: 'contain',
            anchor: 'center',
            cropPolicy: 'protect-subject',
            subjectFillRatio: 1
        },
        canvas: { width: 1000, height: 1000 }
    });
    assert.ok(plan.subjectFill.requiredScaleRatio > 99);
    assert.ok(plan.subjectFill.geometryPlan.alignParams.scalePercent > 9900);
    assert.equal(plan.subjectFill.preverification.status, 'passed');
});

console.log('[7] 写前计划：源事实与语义冲突');

check('源尺寸与画布尺寸必须是明确正数，不从 Photoshop 或 IPC 补取', () => {
    expectPrewriteIssue({
        ...normalPrewriteInput,
        source: { width: 0, height: 200 },
        canvas: { width: Number.NaN, height: 800 }
    }, 'explicit_positive_source_size_required');
    expectPrewriteIssue({
        ...normalPrewriteInput,
        source: { width: 0, height: 200 },
        canvas: { width: Number.NaN, height: 800 }
    }, 'explicit_positive_canvas_size_required');
});

check('传入主体事实时，归一化框、method 与 confidence 都必须有效', () => {
    const issues = expectPrewriteIssue({
        ...normalPrewriteInput,
        source: {
            width: 100,
            height: 200,
            subject: {
                box: { x: 0.8, y: 0, width: 0.3, height: 1 },
                method: 'guessed',
                confidence: 'unknown'
            }
        }
    }, 'normalized_source_subject_box_required');
    assert.ok(issues.some((issue) => issue.code === 'explicit_subject_method_required'));
    assert.ok(issues.some((issue) => issue.code === 'explicit_subject_confidence_required'));
});

check('主体占比缺少主体框，或只有 frame/low 证据时明确阻断', () => {
    const base = {
        source: { width: 1000, height: 1000 },
        target: { x: 0, y: 0, width: 400, height: 400 },
        placement: {
            fit: 'contain',
            anchor: 'center',
            cropPolicy: 'protect-subject',
            subjectFillRatio: 0.8
        },
        canvas: { width: 800, height: 800 }
    };
    expectPrewriteIssue(base, 'subject_facts_required_for_subject_fill');
    expectPrewriteIssue({
        ...base,
        source: {
            width: 1000,
            height: 1000,
            subject: {
                box: { x: 0, y: 0, width: 1, height: 1 },
                method: 'frame',
                confidence: 'low'
            }
        }
    }, 'subject_evidence_unusable_for_subject_fill');
});

check('subjectFillRatio 不会静默覆盖 cover 或 focalPoint 的另一套构图语义', () => {
    const issues = expectPrewriteIssue({
        source: {
            width: 1000,
            height: 1000,
            subject: {
                box: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
                method: 'matting',
                confidence: 'medium'
            }
        },
        target: { x: 0, y: 0, width: 400, height: 300 },
        placement: {
            fit: 'cover',
            anchor: 'center',
            cropPolicy: 'allow-crop',
            focalPoint: { x: 0.5, y: 0.4 },
            subjectFillRatio: 0.7
        },
        canvas: { width: 800, height: 800 }
    }, 'subject_fill_requires_contain_semantics');
    assert.ok(issues.some((issue) => issue.code === 'focal_point_conflicts_with_subject_fill'));
});

console.log('[8] 写前计划：cover + protect-subject');

check('cover + protect-subject 没有可靠主体事实时不能伪称已经保护', () => {
    expectPrewriteIssue({
        source: { width: 100, height: 100 },
        target: { x: 0, y: 0, width: 100, height: 50 },
        placement: {
            fit: 'cover',
            anchor: 'center',
            cropPolicy: 'protect-subject'
        },
        canvas: { width: 100, height: 50 }
    }, 'subject_facts_required_for_protection');
});

check('cover 裁到主体时返回精确冲突事实，而 allow-crop 保留同一几何意图', () => {
    const input = {
        source: {
            width: 100,
            height: 100,
            subject: {
                box: { x: 0, y: 0, width: 1, height: 0.5 },
                method: 'matting',
                confidence: 'medium'
            }
        },
        target: { x: 0, y: 0, width: 100, height: 50 },
        placement: {
            fit: 'cover',
            anchor: 'center',
            cropPolicy: 'protect-subject'
        },
        canvas: { width: 100, height: 50 }
    };
    const issues = expectPrewriteIssue(input, 'protected_subject_crop_detected_prewrite');
    const conflict = issues.find((issue) => issue.code === 'protected_subject_crop_detected_prewrite');
    closeTo(conflict.facts.visibleRatio, 0.5);
    assert.deepEqual(conflict.facts.clippedEdges, ['top']);

    const allowed = expectPrewritePlan({
        ...input,
        placement: { ...input.placement, cropPolicy: 'allow-crop' }
    });
    assert.equal(allowed.mode, 'normal');
    assert.equal(allowed.subjectProtection, undefined);
    closeTo(allowed.normalPreview.subject.visibleRatio, 0.5);
});

check('protect-subject 采用完整保护语义，极小越界也不会被 98.5% 隐藏阈值吞掉', () => {
    const issues = expectPrewriteIssue({
        source: {
            width: 100,
            height: 100,
            subject: {
                box: { x: 0, y: 0.2499, width: 1, height: 0.5 },
                method: 'trim',
                confidence: 'high'
            }
        },
        target: { x: 0, y: 0, width: 100, height: 50 },
        placement: {
            fit: 'cover',
            anchor: 'center',
            cropPolicy: 'protect-subject'
        },
        canvas: { width: 100, height: 50 }
    }, 'protected_subject_crop_detected_prewrite');
    const visibleRatio = issues[0].facts.visibleRatio;
    assert.ok(visibleRatio < 1 && visibleRatio > 0.999);
});

check('主体完整位于 cover 可见带时，计划只确认几何保护事实而不声明审美通过', () => {
    const plan = expectPrewritePlan({
        source: {
            width: 100,
            height: 100,
            subject: {
                box: { x: 0, y: 0.25, width: 1, height: 0.5 },
                method: 'alpha',
                confidence: 'certain'
            }
        },
        target: { x: 0, y: 0, width: 100, height: 50 },
        placement: {
            fit: 'cover',
            anchor: 'center',
            cropPolicy: 'protect-subject'
        },
        canvas: { width: 100, height: 50 }
    });
    assert.equal(plan.subjectProtection.satisfied, true);
    closeTo(plan.subjectProtection.visibleRatio, 1);
    assert.equal(plan.boundaries.noAestheticVerdict, true);
    const serialized = JSON.stringify(plan);
    assert.ok(!serialized.includes('severity'));
    assert.ok(!serialized.includes('recommendedStrategies'));
    assert.ok(!serialized.includes('aestheticScore'));
});

console.log(`\n[OK] 图片落位写前预览：${passed} 项断言通过`);
