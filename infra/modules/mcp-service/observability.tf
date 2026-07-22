# =============================================================================
# PER-ENVIRONMENT ALARMS AND AUTOSCALING
# =============================================================================

# -----------------------------------------------------------------------------
# CloudWatch Alarms
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  count = var.alarm_sns_topic_arn != null ? 1 : 0

  alarm_name          = "${var.name_prefix}-target-5xx"
  alarm_description   = "MCP ${var.environment} elevated 5xx errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = aws_lb_target_group.mcp.arn_suffix
  }

  alarm_actions = [var.alarm_sns_topic_arn]
  ok_actions    = [var.alarm_sns_topic_arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_tasks" {
  count = var.alarm_sns_topic_arn != null ? 1 : 0

  alarm_name          = "${var.name_prefix}-unhealthy-tasks"
  alarm_description   = "MCP ${var.environment}: no healthy tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = aws_lb_target_group.mcp.arn_suffix
  }

  alarm_actions = [var.alarm_sns_topic_arn]
  ok_actions    = [var.alarm_sns_topic_arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "high_latency" {
  count = var.alarm_sns_topic_arn != null ? 1 : 0

  alarm_name          = "${var.name_prefix}-p95-latency"
  alarm_description   = "MCP ${var.environment}: p95 response > 3s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  extended_statistic  = "p95"
  threshold           = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = aws_lb_target_group.mcp.arn_suffix
  }

  alarm_actions = [var.alarm_sns_topic_arn]
  ok_actions    = [var.alarm_sns_topic_arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  count = var.alarm_sns_topic_arn != null ? 1 : 0

  alarm_name          = "${var.name_prefix}-high-cpu"
  alarm_description   = "MCP ${var.environment}: sustained high CPU"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = aws_ecs_service.mcp.name
  }

  alarm_actions = [var.alarm_sns_topic_arn]
  ok_actions    = [var.alarm_sns_topic_arn]

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Application Auto Scaling
# -----------------------------------------------------------------------------

resource "aws_appautoscaling_target" "mcp" {
  max_capacity       = var.service_max_count
  min_capacity       = var.service_min_count
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.mcp.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name_prefix}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.mcp.resource_id
  scalable_dimension = aws_appautoscaling_target.mcp.scalable_dimension
  service_namespace  = aws_appautoscaling_target.mcp.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "requests" {
  name               = "${var.name_prefix}-requests"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.mcp.resource_id
  scalable_dimension = aws_appautoscaling_target.mcp.scalable_dimension
  service_namespace  = aws_appautoscaling_target.mcp.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_requests_per_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${var.alb_arn_suffix}/${aws_lb_target_group.mcp.arn_suffix}"
    }
  }
}
